/**
 * Query harness service — orchestrates the three query sub-harnesses
 * (decompose, boost, rerank) following the ReorgHarnessService pattern.
 *
 * Template selection → query processing → feedback → refinement.
 *
 * Concurrency-safe: no shared mutable state between queries. Each method
 * returns the selected node ID so the caller can pass it explicitly to
 * recordOutcome() and refineIfNeeded().
 */

import {randomUUID} from 'node:crypto'

import type {IContentGenerator} from '../../../../agent/core/interfaces/i-content-generator.js'
import type {SearchKnowledgeResult} from '../../../../agent/infra/sandbox/tools-sdk.js'
import type {HarnessNode, IHarnessTreeStore} from '../../../core/interfaces/harness/i-harness-tree-store.js'

import {HarnessEngine} from '../harness-engine.js'
import {DEFAULT_ALPHA, DEFAULT_BETA} from '../thompson-sampler.js'
import {applyBoostAdjustments, computeBoostAdjustments} from './query-boost-template.js'
import {type DecomposedQuery, decomposeQuery} from './query-decomposer-template.js'
import {buildQueryFeedback, type QueryOutcome} from './query-feedback-collector.js'
import {rerankResults} from './query-reranker-template.js'

// ── Cold-start templates ────────────────────────────────────────────────────

export const DECOMPOSE_ROOT_TEMPLATE = `synonyms: {}
domainHints: []
`

export const BOOST_ROOT_TEMPLATE = `scoreAdjustments:
  domainMatchBonus: 0
  titleMatchBonus: 0
  crossReferenceBonus: 0
`

export const RERANK_ROOT_TEMPLATE = `reranking:
  domainCoherenceWeight: 0
  queryClassification: {}
`

// ── Domain constants ────────────────────────────────────────────────────────

const DOMAIN_DECOMPOSE = 'query/decompose'
const DOMAIN_BOOST = 'query/boost'
const DOMAIN_RERANK = 'query/rerank'

// ── Types ───────────────────────────────────────────────────────────────────

export interface QueryNodeIds {
  boost?: string
  decompose?: string
  rerank?: string
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * Orchestrates the query harness cycle: decompose → boost → rerank.
 *
 * All public methods are stateless with respect to per-query state — node IDs
 * are returned from each method and passed explicitly to feedback/refinement.
 * This makes the service safe for concurrent queries.
 */
export class QueryHarnessService {
  private readonly boostEngine: HarnessEngine
  private readonly decomposeEngine: HarnessEngine
  private readonly rerankEngine: HarnessEngine
  private readonly treeStore: IHarnessTreeStore

  constructor(deps: {
    boostEngine: HarnessEngine
    decomposeEngine: HarnessEngine
    rerankEngine: HarnessEngine
    treeStore: IHarnessTreeStore
  }) {
    this.boostEngine = deps.boostEngine
    this.decomposeEngine = deps.decomposeEngine
    this.rerankEngine = deps.rerankEngine
    this.treeStore = deps.treeStore
  }

  /**
   * Apply post-search boost adjustments to results.
   * Returns adjusted results and the selected node ID.
   */
  async adjustBoosts(
    results: SearchKnowledgeResult['results'],
    query: string,
    domainHints: string[],
  ): Promise<{nodeId?: string; results: SearchKnowledgeResult['results']}> {
    const selection = await this.selectOrSeed(this.boostEngine, DOMAIN_BOOST, BOOST_ROOT_TEMPLATE)
    const templateContent = selection?.node.templateContent ?? BOOST_ROOT_TEMPLATE
    const adjustments = computeBoostAdjustments(templateContent)

    return {
      nodeId: selection?.node.id,
      results: applyBoostAdjustments(results, adjustments, query, domainHints),
    }
  }

  /**
   * Decompose a raw query using synonym expansion and domain hints.
   * Returns decomposed query and the selected node ID.
   */
  async decomposeQuery(query: string): Promise<{decomposed: DecomposedQuery; nodeId?: string}> {
    const selection = await this.selectOrSeed(this.decomposeEngine, DOMAIN_DECOMPOSE, DECOMPOSE_ROOT_TEMPLATE)
    const templateContent = selection?.node.templateContent ?? DECOMPOSE_ROOT_TEMPLATE

    return {
      decomposed: decomposeQuery(query, templateContent),
      nodeId: selection?.node.id,
    }
  }

  /**
   * Record feedback from query execution outcomes.
   * Node IDs are passed explicitly (not stored as instance state).
   */
  async recordOutcome(nodeIds: QueryNodeIds, outcome: QueryOutcome): Promise<void> {
    const feedbacks = buildQueryFeedback(nodeIds, outcome)

    const updatePromises = feedbacks.map((feedback) => {
      const role = typeof feedback.details.role === 'string' ? feedback.details.role : undefined
      if (!role) return Promise.resolve()
      const engine = this.getEngineForRole(role)
      if (!engine) return Promise.resolve()

      // Respect per-feedback success flag — a supplemented decompose miss gets
      // success=false from buildQueryFeedback(), so it should NOT receive the
      // partial-success F1 update even on a Tier 3 prefetched query.
      if (!feedback.success) {
        return engine.recordOutcome(feedback)
      }

      // Partial success (Tier 3: prefetched but needed LLM)
      return outcome.prefetched && !outcome.directHit
        ? engine.recordOutcomeF1(feedback.nodeId, 0.7, 0.3, feedback)
        : engine.recordOutcome(feedback)
    })

    await Promise.all(updatePromises)
  }

  /**
   * Trigger async refinement for the given node IDs.
   * Call this non-blocking (fire-and-forget with .catch(() => {})).
   */
  async refineIfNeeded(nodeIds: QueryNodeIds): Promise<void> {
    const promises: Promise<unknown>[] = []

    for (const [role, nodeId] of Object.entries(nodeIds)) {
      if (!nodeId) continue
      const engine = this.getEngineForRole(role)
      if (engine) {
        promises.push(engine.runRefinementCycle(nodeId))
      }
    }

    await Promise.all(promises)
  }

  /**
   * Re-rank results based on domain coherence and query classification.
   * Returns re-ranked results and the selected node ID.
   */
  async rerankResults(
    results: SearchKnowledgeResult['results'],
    query: string,
  ): Promise<{nodeId?: string; results: SearchKnowledgeResult['results']}> {
    const selection = await this.selectOrSeed(this.rerankEngine, DOMAIN_RERANK, RERANK_ROOT_TEMPLATE)
    const templateContent = selection?.node.templateContent ?? RERANK_ROOT_TEMPLATE

    return {
      nodeId: selection?.node.id,
      results: rerankResults(results, templateContent, query),
    }
  }

  /**
   * Set the content generator for all sub-harness engines.
   * Call after the agent starts to enable refinement.
   */
  setContentGenerator(generator: IContentGenerator): void {
    this.decomposeEngine.setContentGenerator(generator)
    this.boostEngine.setContentGenerator(generator)
    this.rerankEngine.setContentGenerator(generator)
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private getEngineForRole(role: string): HarnessEngine | undefined {
    switch (role) {
      case 'boost': {
        return this.boostEngine
      }

      case 'decompose': {
        return this.decomposeEngine
      }

      case 'rerank': {
        return this.rerankEngine
      }

      default: {
        return undefined
      }
    }
  }

  /**
   * Select a template via Thompson sampling, seeding the root node on cold start.
   *
   * Concurrent cold-start: two queries on an empty tree may both seed a root node.
   * This is harmless — Thompson sampling will select between competing roots, and
   * the weaker one accumulates no visits and eventually falls off. Accepted trade-off
   * vs adding a domain-scoped lock for a one-time startup event.
   */
  private async selectOrSeed(
    engine: HarnessEngine,
    domain: string,
    defaultTemplate: string,
  ): Promise<null | {mode: 'fast' | 'shadow'; node: HarnessNode}> {
    const selection = await engine.selectTemplate()
    if (selection) {
      return {mode: selection.mode, node: selection.node}
    }

    // Cold-start: seed root node with default template
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
      templateContent: defaultTemplate,
      visitCount: 0,
    }

    await this.treeStore.saveNode(domain, rootNode)

    const seededSelection = await engine.selectTemplate()
    if (seededSelection) {
      return {mode: seededSelection.mode, node: seededSelection.node}
    }

    return null
  }
}
