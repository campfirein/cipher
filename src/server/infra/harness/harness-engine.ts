/**
 * Core AutoHarness engine implementation.
 *
 * Coordinates Thompson-sampling-based template selection, feedback recording,
 * and LLM-based refinement. Uses constructor DI with a deps object.
 */

import {randomUUID} from 'node:crypto'

import type {IContentGenerator} from '../../../agent/core/interfaces/i-content-generator.js'
import type {HarnessEngineConfig, HarnessSelection, IHarnessEngine} from '../../core/interfaces/harness/i-harness-engine.js'
import type {HarnessFeedback} from '../../core/interfaces/harness/i-harness-feedback.js'
import type {HarnessNode, IHarnessTreeStore} from '../../core/interfaces/harness/i-harness-tree-store.js'

import {consolidateErrors} from './harness-critic.js'
import {refineTemplate} from './harness-refiner.js'
import {DEFAULT_ALPHA, DEFAULT_BETA, determineMode, thompsonSelect, updateBetaParams, updateBetaParamsF1} from './thompson-sampler.js'

// ── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: HarnessEngineConfig = {
  convergenceThreshold: 1,
  domain: 'default',
  maxChildren: 5,
  maxIterations: 3,
  refinementCooldown: 5,
}

// ── Engine ───────────────────────────────────────────────────────────────────

export interface HarnessEngineDeps {
  config?: Partial<HarnessEngineConfig>
  contentGenerator?: IContentGenerator
  treeStore: IHarnessTreeStore
}

export class HarnessEngine implements IHarnessEngine {
  private readonly config: HarnessEngineConfig
  private contentGenerator: IContentGenerator | undefined
  /** Per-node promise chains to serialize read-modify-write on node state */
  private readonly nodeLocks = new Map<string, Promise<void>>()
  /** Per-domain operation counter for refinement cooldown */
  private readonly operationCounts = new Map<string, number>()
  /** Per-node recent feedback buffer */
  private readonly recentFeedback = new Map<string, HarnessFeedback[]>()
  /** Nodes currently undergoing refinement (prevents duplicate cycles) */
  private readonly refiningNodes = new Set<string>()
  private readonly treeStore: IHarnessTreeStore

  constructor(deps: HarnessEngineDeps) {
    this.config = {...DEFAULT_CONFIG, ...deps.config}
    this.contentGenerator = deps.contentGenerator
    this.treeStore = deps.treeStore
  }

  async recordOutcome(feedback: HarnessFeedback): Promise<void> {
    await this.withNodeLock(feedback.nodeId, async () => {
      const {domain} = this.config
      const node = await this.treeStore.getNode(domain, feedback.nodeId)
      if (!node) return

      // Update Beta parameters (binary success/failure)
      const updated = updateBetaParams(node, feedback.success)
      const updatedNode: HarnessNode = {
        ...node,
        alpha: updated.alpha,
        beta: updated.beta,
        heuristic: updated.heuristic,
        visitCount: node.visitCount + 1,
      }

      await this.treeStore.saveNode(domain, updatedNode)
    })

    this.bufferFeedback(feedback.nodeId, feedback)
  }

  /**
   * Record fractional F1-score feedback (shadow mode).
   * Uses updateBetaParamsF1 for continuous alpha/beta increments.
   */
  async recordOutcomeF1(
    nodeId: string,
    f1Alpha: number,
    f1Beta: number,
    feedback: HarnessFeedback,
  ): Promise<void> {
    await this.withNodeLock(nodeId, async () => {
      const {domain} = this.config
      const node = await this.treeStore.getNode(domain, nodeId)
      if (!node) return

      const updated = updateBetaParamsF1(node, f1Alpha, f1Beta)
      const updatedNode: HarnessNode = {
        ...node,
        alpha: updated.alpha,
        beta: updated.beta,
        heuristic: updated.heuristic,
        visitCount: node.visitCount + 1,
      }

      await this.treeStore.saveNode(domain, updatedNode)
    })

    this.bufferFeedback(feedback.nodeId, feedback)
  }

  async refine(nodeId: string, feedbackSummary: string): Promise<HarnessNode> {
    const {domain} = this.config

    // Read parent for templateContent (used by LLM refiner — no state mutation yet)
    const parentSnapshot = await this.treeStore.getNode(domain, nodeId)
    if (!parentSnapshot) {
      throw new Error(`Node ${nodeId} not found in domain ${domain}`)
    }

    // Generate improved template via LLM (slow, does not touch node state)
    if (!this.contentGenerator) {
      throw new Error('Content generator not set — call setContentGenerator() before refine()')
    }

    const improvedContent = await refineTemplate(
      this.contentGenerator,
      parentSnapshot.templateContent,
      feedbackSummary,
      domain,
    )

    // Create child node
    const childId = randomUUID()
    const childNode: HarnessNode = {
      alpha: DEFAULT_ALPHA,
      beta: DEFAULT_BETA,
      childIds: [],
      createdAt: Date.now(),
      heuristic: DEFAULT_ALPHA / (DEFAULT_ALPHA + DEFAULT_BETA),
      id: childId,
      metadata: {parentHeuristic: parentSnapshot.heuristic, refinementReason: feedbackSummary.slice(0, 200)},
      parentId: nodeId,
      templateContent: improvedContent,
      visitCount: 0,
    }

    // Save the child BEFORE updating the parent, so pruning can see
    // the new child's heuristic when deciding which child to evict.
    await this.treeStore.saveNode(domain, childNode)

    // Update parent's childIds under the node lock.
    // Re-reads the parent inside the lock so concurrent feedback updates
    // to alpha/beta/visitCount are not clobbered by the stale snapshot.
    await this.withNodeLock(nodeId, async () => {
      const freshParent = await this.treeStore.getNode(domain, nodeId)
      if (!freshParent) return

      const updatedChildIds = [...freshParent.childIds, childId]

      // Prune if too many children
      let finalChildIds = updatedChildIds
      if (updatedChildIds.length > this.config.maxChildren) {
        const allChildren = await Promise.all(
          updatedChildIds.map((id) => this.treeStore.getNode(domain, id)),
        )
        const validChildren = allChildren.filter((c): c is HarnessNode => c !== null)
        if (validChildren.length > 0) {
          let worst = validChildren[0]
          for (const child of validChildren) {
            if (child.heuristic < worst.heuristic) {
              worst = child
            }
          }

          await this.treeStore.deleteNode(domain, worst.id)
          finalChildIds = updatedChildIds.filter((id) => id !== worst.id)
        }
      }

      // Only update childIds on the fresh parent — preserves concurrent alpha/beta changes
      await this.treeStore.saveNode(domain, {...freshParent, childIds: finalChildIds})
    })

    return childNode
  }

  /**
   * Run the full refinement cycle: consolidate errors via critic, then refine.
   * Should be called asynchronously (non-blocking) after recording outcomes.
   *
   * Guarded by refiningNodes set to prevent concurrent cycles for the same node.
   */
  async runRefinementCycle(nodeId: string): Promise<HarnessNode | null> {
    const {domain} = this.config
    if (!this.contentGenerator) return null // No LLM available for refinement

    // Prevent concurrent refinement for the same node
    if (this.refiningNodes.has(nodeId)) return null
    this.refiningNodes.add(nodeId)

    let consumedBuffer: HarnessFeedback[] | undefined
    try {
      if (!this.shouldRefine(domain, nodeId)) return null

      const node = await this.treeStore.getNode(domain, nodeId)
      if (!node) return null

      // Skip refinement if node has already converged
      if (node.heuristic >= this.config.convergenceThreshold) return null

      // Snapshot and consume the buffer BEFORE the async critic/refiner calls.
      // This prevents a second concurrent cycle from using the same entries.
      const buffer = this.recentFeedback.get(nodeId) ?? []
      if (buffer.length === 0) return null
      // Clear immediately — new feedback arriving during refinement goes to a fresh buffer
      consumedBuffer = [...buffer]
      this.recentFeedback.delete(nodeId)

      // Critic: consolidate feedback (failures + sub-threshold shadow runs)
      const criticSummary = await consolidateErrors(
        this.contentGenerator!,
        consumedBuffer,
        node.templateContent,
        domain,
      )

      if (!criticSummary) {
        // No actionable feedback — restore the buffer for next attempt
        this.restoreBuffer(nodeId, consumedBuffer)
        consumedBuffer = undefined // Mark as restored

        return null
      }

      // Refiner: generate improved child
      const child = await this.refine(nodeId, criticSummary)

      // Successfully consumed — don't restore on finally
      consumedBuffer = undefined

      const currentCount = this.operationCounts.get(domain) ?? 0
      this.operationCounts.set(domain, Math.max(0, currentCount - buffer.length))

      return child
    } finally {
      // Restore buffer if it was consumed but not successfully used
      // (critic or refiner threw an error)
      if (consumedBuffer) {
        this.restoreBuffer(nodeId, consumedBuffer)
      }

      this.refiningNodes.delete(nodeId)
    }
  }

  async selectTemplate(): Promise<HarnessSelection | null> {
    const {domain} = this.config
    const nodes = await this.treeStore.getAllNodes(domain)
    if (nodes.length === 0) return null

    const selected = thompsonSelect(nodes)
    if (!selected) return null

    return {
      mode: determineMode(selected),
      node: selected,
    }
  }

  /**
   * Set or replace the content generator used for critic/refiner LLM calls.
   * Call this after the agent starts to inject the real LLM.
   */
  setContentGenerator(generator: IContentGenerator): void {
    this.contentGenerator = generator
  }

  shouldRefine(domain: string, nodeId: string): boolean {
    const count = this.operationCounts.get(domain) ?? 0
    if (count < this.config.refinementCooldown) return false

    const buffer = this.recentFeedback.get(nodeId) ?? []
    if (buffer.length === 0) return false

    // Refine when there are explicit failures for this node
    const failures = buffer.filter((f) => !f.success)
    if (failures.length > 0) return true

    // Also refine when shadow-mode evaluations have accumulated enough for this node.
    // This prevents mid-quality templates (F1 > 0.5 but heuristic < 0.9) from stalling
    // indefinitely in shadow mode. The convergence check in runRefinementCycle()
    // prevents already-converged nodes from spawning unnecessary children.
    const shadowEntries = buffer.filter((f) =>
      f.details.mode === 'shadow' &&
      typeof f.details.f1Score === 'number' &&
      f.details.f1Score < 1,
    )

    return shadowEntries.length >= this.config.refinementCooldown
  }

  private bufferFeedback(nodeId: string, feedback: HarnessFeedback): void {
    // Buffer keyed by nodeId — each node has its own feedback history
    const buffer = this.recentFeedback.get(nodeId) ?? []
    buffer.push(feedback)
    // Keep only last 20 feedback entries per node
    if (buffer.length > 20) buffer.shift()
    this.recentFeedback.set(nodeId, buffer)

    // Operation counter stays domain-wide (for cooldown gating)
    const {domain} = this.config
    const count = (this.operationCounts.get(domain) ?? 0) + 1
    this.operationCounts.set(domain, count)
  }

  /**
   * Prepend previously consumed entries back onto the node's feedback buffer.
   * New entries appended during refinement are preserved at the end.
   * Enforces the same 20-entry cap as bufferFeedback() — keeps newest entries.
   */
  private restoreBuffer(nodeId: string, entries: HarnessFeedback[]): void {
    const current = this.recentFeedback.get(nodeId) ?? []
    const merged = [...entries, ...current]
    // Keep only the last 20 entries (same cap as bufferFeedback)
    this.recentFeedback.set(nodeId, merged.length > 20 ? merged.slice(-20) : merged)
  }

  /**
   * Serialize access to a specific node's state.
   * Concurrent callers for the same nodeId are queued; different nodeIds run in parallel.
   */
  private async withNodeLock(nodeId: string, fn: () => Promise<void>): Promise<void> {
    const previous = this.nodeLocks.get(nodeId) ?? Promise.resolve()
    const current = previous.then(fn, fn) // Run fn after previous completes (even on error)
    this.nodeLocks.set(nodeId, current)

    try {
      await current
    } finally {
      // Clean up if we're still the tail of the chain
      if (this.nodeLocks.get(nodeId) === current) {
        this.nodeLocks.delete(nodeId)
      }
    }
  }
}
