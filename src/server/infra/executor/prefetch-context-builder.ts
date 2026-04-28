/**
 * Shared helper for assembling a pre-fetched context bundle from BM25 search
 * results. Used by:
 *   - QueryExecutor (legacy `brv_query` tier 3 path) for LLM prompt injection
 *   - GatherExecutor (Phase 5 `brv_gather` MCP + `brv gather` CLI) for the
 *     MCP-side bundle returned to external agents
 *
 * Pure function — no I/O. Excerpts are taken from the search result as-is
 * (full document reads are out of scope here; deferred to direct-search-responder
 * for the legacy direct-answer path).
 */

import type {SearchKnowledgeResult} from '../../../agent/infra/sandbox/tools-sdk.js'

/** Minimum normalized score for a result to be included in the prefetched bundle. */
export const PREFETCH_SCORE_THRESHOLD = 0.7

/**
 * Build a markdown-formatted context bundle from high-confidence search hits.
 * Returns undefined when no results clear the score threshold.
 */
export function buildPrefetchedContext(searchResult: SearchKnowledgeResult): string | undefined {
  if (searchResult.totalFound === 0) return undefined

  const highConfidenceResults = searchResult.results.filter((r) => r.score >= PREFETCH_SCORE_THRESHOLD)

  if (highConfidenceResults.length === 0) return undefined

  const sections = highConfidenceResults.map((r) => {
    const source =
      r.origin === 'shared' && r.originAlias ? `[${r.originAlias}]:${r.path}` : `.brv/context-tree/${r.path}`

    return `### ${r.title}\n**Source**: ${source}\n\n${r.excerpt}`
  })

  return sections.join('\n\n---\n\n')
}
