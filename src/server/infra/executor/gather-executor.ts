/* eslint-disable camelcase -- DESIGN §6.2 specifies snake_case for MCP-facing fields */

/**
 * GatherExecutor (Phase 5 Task 5.3) — daemon-side handler for `brv_gather`
 * MCP tool and `brv gather` CLI command.
 *
 * Pure data assembly:
 *   1. Run BM25 via the shared `ISearchKnowledgeService`.
 *   2. Build prefetched context bundle (shared `buildPrefetchedContext` helper).
 *   3. Estimate total tokens.
 *   4. Compute rule-based `follow_up_hints` (sparse results / low confidence).
 *
 * Critical invariant (DESIGN §4.2): NEVER invokes the LLM. The agent (or
 * human user) synthesizes the answer from the returned bundle. If you find
 * yourself adding `agent.executeOnSession` here, stop.
 *
 * Manifest-context assembly (broad structural snippets via
 * `FileContextTreeManifestService`) is deferred — gather-executor stays
 * pure data + searchService for now. Future enhancement: inject a
 * `manifestService` dep when needed.
 */

import type {ISearchKnowledgeService, SearchKnowledgeResult} from '../../../agent/infra/sandbox/tools-sdk.js'
import type {GatherExecuteOptions, GatherResult, IGatherExecutor} from '../../core/interfaces/executor/i-gather-executor.js'

import {estimateTokens} from '../../../shared/utils/escalation-utils.js'
import {buildPrefetchedContext} from './prefetch-context-builder.js'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50
const DEFAULT_TOKEN_BUDGET = 4000

/** Below this top-score, surface a low-confidence hint. */
const LOW_CONFIDENCE_TOP_SCORE = 0.5

/** At-or-below this many results, surface a sparse-results hint. */
const SPARSE_RESULTS_THRESHOLD = 2

export interface GatherExecutorDeps {
  searchService: ISearchKnowledgeService
}

export class GatherExecutor implements IGatherExecutor {
  private readonly searchService: ISearchKnowledgeService

  constructor(deps: GatherExecutorDeps) {
    this.searchService = deps.searchService
  }

  async execute(options: GatherExecuteOptions): Promise<GatherResult> {
    const query = options.query.trim()
    if (!query) {
      return emptyResult()
    }

    const limit = clampLimit(options.limit)
    const scope = options.scope?.trim() || undefined

    let searchResult: SearchKnowledgeResult
    try {
      searchResult = await this.searchService.search(query, {
        limit,
        ...(scope ? {scope} : {}),
      })
    } catch {
      return emptyResult()
    }

    const prefetchedContext = buildPrefetchedContext(searchResult) ?? ''
    const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET
    const truncatedPrefetched = applyTokenBudget(prefetchedContext, tokenBudget)
    const totalTokens = estimateTokens(truncatedPrefetched)

    const followUpHints = computeFollowUpHints(searchResult)
    const topScore = searchResult.results[0]?.score ?? 0

    return {
      ...(followUpHints.length > 0 ? {follow_up_hints: followUpHints} : {}),
      prefetched_context: truncatedPrefetched,
      search_metadata: {
        result_count: searchResult.results.length,
        top_score: topScore,
        total_found: searchResult.totalFound,
      },
      total_tokens_estimated: totalTokens,
    }
  }
}

function emptyResult(): GatherResult {
  return {
    prefetched_context: '',
    search_metadata: {result_count: 0, top_score: 0, total_found: 0},
    total_tokens_estimated: 0,
  }
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)))
}

/**
 * If the bundle exceeds the token budget, truncate to the last full section
 * (sections are joined by `\n\n---\n\n` per `buildPrefetchedContext`).
 */
function applyTokenBudget(bundle: string, tokenBudget: number): string {
  if (!bundle) return bundle
  const tokens = estimateTokens(bundle)
  if (tokens <= tokenBudget) return bundle

  const sections = bundle.split('\n\n---\n\n')
  const kept: string[] = []
  let accumulated = 0
  for (const section of sections) {
    const sectionTokens = estimateTokens(section)
    if (accumulated + sectionTokens > tokenBudget) break
    kept.push(section)
    accumulated += sectionTokens
  }

  return kept.join('\n\n---\n\n')
}

function computeFollowUpHints(searchResult: SearchKnowledgeResult): string[] {
  const hints: string[] = []
  const topScore = searchResult.results[0]?.score ?? 0

  if (searchResult.results.length <= SPARSE_RESULTS_THRESHOLD && searchResult.totalFound <= SPARSE_RESULTS_THRESHOLD) {
    hints.push(
      `few results (${searchResult.results.length}) — try a broader query or expand scope to surface adjacent topics`,
    )
  }

  if (searchResult.results.length > 0 && topScore < LOW_CONFIDENCE_TOP_SCORE) {
    hints.push(
      `top score ${topScore.toFixed(2)} indicates low confidence — consider rephrasing or adding context-specific terms`,
    )
  }

  return hints
}
