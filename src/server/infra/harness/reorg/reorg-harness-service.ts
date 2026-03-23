/**
 * Reorg harness service — orchestrates the full AutoHarness cycle for
 * context tree reorganisation (merge / move).
 *
 * Follows the CurationHarnessService pattern:
 * template selection → detection → validation → execution → feedback → refinement.
 */

import {randomUUID} from 'node:crypto'

import type {IContentGenerator} from '../../../../agent/core/interfaces/i-content-generator.js'
import type {ReorgCandidate, ReorgResult} from '../../../core/interfaces/executor/i-reorg-executor.js'
import type {HarnessNode, IHarnessTreeStore} from '../../../core/interfaces/harness/i-harness-tree-store.js'

import {HarnessEngine} from '../harness-engine.js'
import {DEFAULT_ALPHA, DEFAULT_BETA} from '../thompson-sampler.js'
import {detectCandidates} from './reorg-detection-template.js'
import {buildReorgFeedback} from './reorg-feedback-collector.js'
import {validateCandidates} from './reorg-safety-validator.js'

// ── Cold-start template ─────────────────────────────────────────────────────

/**
 * Default YAML template for reorg detection thresholds.
 * Seeded as the root node when the harness tree is empty.
 */
export const REORG_ROOT_TEMPLATE = `mergeDetection:
  keywordOverlapThreshold: 0.7
  minImportanceForKeep: 35
moveDetection:
  crossDomainKeywordMatchThreshold: 0.6
`

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * Orchestrates the reorg harness cycle following CurationHarnessService pattern.
 */
export class ReorgHarnessService {
  private readonly domain: string
  private readonly treeStore: IHarnessTreeStore

  constructor(
    private readonly engine: HarnessEngine,
    treeStore: IHarnessTreeStore,
    domain = 'reorg',
  ) {
    this.treeStore = treeStore
    this.domain = domain
  }

  /**
   * Detect candidates and validate them in a single call.
   *
   * Selects a template, runs detection, then validates the results.
   */
  async detectAndValidate(params: {
    contextTreeDir: string
  }): Promise<{
    candidates: ReorgCandidate[]
    selection: null | {mode: 'fast' | 'shadow'; node: HarnessNode}
    validated: ReorgCandidate[]
  }> {
    const selection = await this.selectTemplate()

    const templateContent = selection?.node.templateContent ?? REORG_ROOT_TEMPLATE

    const candidates = await detectCandidates({
      contextTreeDir: params.contextTreeDir,
      templateContent,
    })

    if (candidates.length === 0) {
      return {candidates: [], selection, validated: []}
    }

    const {approved} = await validateCandidates(
      candidates,
      params.contextTreeDir,
    )

    return {
      candidates,
      selection,
      validated: approved,
    }
  }

  /**
   * Record feedback from reorg execution results.
   * Updates the harness engine with success/failure signals.
   */
  async recordFeedback(nodeId: string, results: ReorgResult[]): Promise<void> {
    const result = buildReorgFeedback(nodeId, results)
    if (!result) return

    // Use fractional F1 scoring for quality-based detector training,
    // not binary recordOutcome(). This trains the harness to select
    // better detection thresholds, not just safer execution paths.
    await this.engine.recordOutcomeF1(nodeId, result.alpha, result.beta, result.feedback)
  }

  /**
   * Trigger async refinement if cooldown passed and failures exist.
   * Call this non-blocking (fire-and-forget with .catch(() => {})).
   */
  async refineIfNeeded(nodeId: string): Promise<void> {
    await this.engine.runRefinementCycle(nodeId)
  }

  /**
   * Select the best reorg template via Thompson sampling.
   *
   * Cold-start: seeds a root node with default YAML thresholds
   * if the tree is empty.
   *
   * @returns Selected node and mode, or null if seeding just occurred
   *          (caller should retry on next cycle).
   */
  async selectTemplate(): Promise<null | {mode: 'fast' | 'shadow'; node: HarnessNode}> {
    const selection = await this.engine.selectTemplate()
    if (selection) {
      return {
        mode: selection.mode,
        node: selection.node,
      }
    }

    // Cold-start: seed root node with default template via treeStore
    const rootId = randomUUID()
    const rootNode: HarnessNode = {
      alpha: DEFAULT_ALPHA,
      beta: DEFAULT_BETA,
      childIds: [],
      createdAt: Date.now(),
      heuristic: DEFAULT_ALPHA / (DEFAULT_ALPHA + DEFAULT_BETA),
      id: rootId,
      metadata: {seedReason: 'cold-start'},
      parentId: null,
      templateContent: REORG_ROOT_TEMPLATE,
      visitCount: 0,
    }

    await this.treeStore.saveNode(this.domain, rootNode)

    // Re-select now that the tree has a node
    const seededSelection = await this.engine.selectTemplate()
    if (seededSelection) {
      return {
        mode: seededSelection.mode,
        node: seededSelection.node,
      }
    }

    return null
  }

  /**
   * Set the content generator for critic/refiner LLM calls.
   * Call after the agent starts to enable refinement.
   */
  setContentGenerator(generator: IContentGenerator): void {
    this.engine.setContentGenerator(generator)
  }
}
