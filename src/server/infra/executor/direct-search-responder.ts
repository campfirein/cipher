/** Score at which the result is so strong that dominance check is skipped */
export const DIRECT_RESPONSE_HIGH_CONFIDENCE_THRESHOLD = 15

/** Minimum score for the top result to qualify for a direct (no-LLM) response */
export const DIRECT_RESPONSE_SCORE_THRESHOLD = 8

/** Top result must be N times the second result's score to be considered dominant */
export const DIRECT_RESPONSE_DOMINANCE_RATIO = 2

/** Maximum content length per document in the direct response */
const MAX_CONTENT_LENGTH = 1500

/** Maximum number of documents to include in the direct response */
const MAX_DOCS = 3

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
 * Requires:
 * 1. Top result score >= DIRECT_RESPONSE_SCORE_THRESHOLD (minimum confidence)
 * 2. Either: top score >= HIGH_CONFIDENCE_THRESHOLD (strong enough to skip dominance check)
 *    Or: top result dominates other results (score >= 2x the second result)
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

  const secondScore = results[1].score
  if (secondScore === 0) return true

  return topResult.score / secondScore >= DIRECT_RESPONSE_DOMINANCE_RATIO
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
