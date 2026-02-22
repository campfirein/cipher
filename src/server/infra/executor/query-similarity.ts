import { removeStopwords } from 'stopword'

/**
 * Pre-computed query tokens for similarity comparison.
 */
export interface QueryTokens {
  /** Original normalized form (for exact match) */
  normalized: string
  /** Stopword-filtered bag of words */
  tokenSet: Set<string>
}

/** Minimum Jaccard similarity to consider a fuzzy cache match */
export const FUZZY_SIMILARITY_THRESHOLD = 0.6

/**
 * Tokenize and prepare a query for similarity comparison.
 * Uses the same stopword library already used by SearchKnowledgeService.
 *
 * @param query - Raw user query string
 * @returns Pre-computed tokens for similarity comparison
 */
export function tokenizeQuery(query: string): QueryTokens {
  const normalized = query.toLowerCase().trim().replaceAll(/\s+/g, ' ')
  const words = normalized.split(' ')
  const filtered = removeStopwords(words).filter((w) => w.length >= 2)
  return {
    normalized,
    tokenSet: new Set(filtered),
  }
}

/**
 * Compute Jaccard similarity between two token sets.
 * Returns value between 0 (no overlap) and 1 (identical).
 *
 * @param a - First token set
 * @param b - Second token set
 * @returns Similarity score between 0 and 1
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0

  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a]
  let intersection = 0
  for (const token of smaller) {
    if (larger.has(token)) intersection++
  }

  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}
