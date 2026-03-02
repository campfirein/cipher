/** Normalized score at which the result is so strong that dominance check is skipped */
export const DIRECT_RESPONSE_HIGH_CONFIDENCE_THRESHOLD = 0.93

/** Minimum normalized score for the top result to qualify for a direct (no-LLM) response */
export const DIRECT_RESPONSE_SCORE_THRESHOLD = 0.85

/** Minimum gap between top and second result's normalized score to be considered dominant */
export const DIRECT_RESPONSE_MIN_GAP = 0.08

/** Maximum content length per document in the direct response */
const MAX_CONTENT_LENGTH = 5000

/** Maximum number of documents to include in the direct response */
const MAX_DOCS = 5

/**
 * A search result with full document content for direct response formatting.
 */
export interface DirectSearchResult {
  content: string
  path: string
  score: number
  title: string
}

/**
 * Determines if search results are confident enough for a direct response
 * without involving the LLM.
 *
 * Uses normalized [0, 1) scores with a gap-based dominance model:
 * 1. Top result score >= DIRECT_RESPONSE_SCORE_THRESHOLD (minimum confidence)
 * 2. Either: top score >= HIGH_CONFIDENCE_THRESHOLD (strong enough to skip dominance check)
 *    Or: gap between top and #2 >= DIRECT_RESPONSE_MIN_GAP (clear separation)
 *
 * Gap-based instead of ratio-based because normalized scores cluster in [0.8, 0.95],
 * making ratio checks (e.g., 2x) impossible to satisfy.
 *
 * @param results - Sorted search results (highest score first)
 * @returns true if a direct response can be served
 */
export function canRespondDirectly(results: DirectSearchResult[]): boolean {
  if (results.length === 0) return false

  const topResult = results[0]
  if (topResult.score < DIRECT_RESPONSE_SCORE_THRESHOLD) return false

  // Single result that passes threshold
  if (results.length === 1) return true

  // High-confidence path: score so strong that dominance is irrelevant
  if (topResult.score >= DIRECT_RESPONSE_HIGH_CONFIDENCE_THRESHOLD) return true

  // Gap-based dominance: top must be clearly separated from #2
  const gap = topResult.score - results[1].score

  return gap >= DIRECT_RESPONSE_MIN_GAP
}

/**
 * Format a direct response from search results (no LLM involved).
 * Uses a structured template matching the existing query response format.
 *
 * @param query - Original user query
 * @param results - Search results with full content
 * @returns Formatted response string
 */
export function formatDirectResponse(query: string, results: DirectSearchResult[]): string {
  const topResults = results.slice(0, MAX_DOCS)

  const summary =
    topResults.length === 1
      ? `Based on the curated knowledge, here is information about "${query}":`
      : `Found ${topResults.length} relevant topics for "${query}":`

  const details = topResults
    .map((r) => {
      const truncatedContent =
        r.content.length > MAX_CONTENT_LENGTH ? `${r.content.slice(0, MAX_CONTENT_LENGTH).trim()}...` : r.content
      return `### ${r.title}\n\n${truncatedContent}`
    })
    .join('\n\n---\n\n')

  const sources = topResults.map((r) => `- \`.brv/context-tree/${r.path}\``).join('\n')

  return `**Summary**: ${summary}

**Details**:

${details}

**Sources**:
${sources}

**Gaps**: This is a direct match from the context tree. For deeper analysis or cross-topic synthesis, try a more specific question.`
}

/**
 * Format a "not found" response when OOD detection determines
 * the query topic is not covered in the knowledge base.
 *
 * @param query - Original user query
 * @returns Formatted not-found response string
 */
export function formatNotFoundResponse(query: string): string {
  return `**Summary**: No matching knowledge found for "${query}".

**Details**: The topic does not appear to be covered in the context tree. This could mean the topic hasn't been curated yet.

**Sources**: None

**Gaps**: Try rephrasing your query with different terms, or use /curate to add knowledge about this topic.`
}
