import type MiniSearch from 'minisearch'

import {removeStopwords} from 'stopword'

// ============================================================
// Constants
// ============================================================

/**
 * Default absolute score floor for adapter-level OOD detection.
 * Lower than ByteRover's 0.45 because adapters use pure BM25 normalization
 * without compound scoring (importance/recency/maturity).
 */
export const DEFAULT_SCORE_FLOOR = 0.3

/**
 * Default gap ratio for adapter-level tail filtering.
 * Slightly tighter than ByteRover's 0.7 to compensate for the
 * absence of compound scoring differentiation.
 */
export const DEFAULT_GAP_RATIO = 0.75

/**
 * Gap ratio for second pass after wikilink expansion.
 * Must be <= WIKILINK_DECAY (0.7) so one-hop expansions are not automatically filtered.
 * Uses 0.6 to give expanded results some headroom.
 */
export const POST_EXPANSION_GAP_RATIO = 0.6

// ============================================================
// Types
// ============================================================

/**
 * Normalized search result from MiniSearch with precision metadata.
 */
export type NormalizedResult = {
  /** Document ID from MiniSearch */
  id: number | string
  /** Score normalized to [0, 1) via score / (1 + score) */
  normalizedScore: number
  /** Query terms that matched (from MiniSearch, for future unmatched-term detection) */
  queryTerms: string[]
  /** Raw MiniSearch BM25 score before normalization */
  rawScore: number
}

/**
 * Options for precision-filtered MiniSearch queries.
 */
export type PrecisionSearchOptions = {
  /** Field boost weights. Default: {title: 2} */
  boost?: Record<string, number>
  /** Fuzzy matching tolerance. Default: 0.2 */
  fuzzy?: number
  /** Gap ratio: only keep results >= topScore * ratio. Default: 0.75 */
  gapRatio?: number
  /** Maximum results to return. Default: 10 */
  maxResults?: number
  /** Enable prefix matching. Default: true */
  prefix?: boolean
  /** Absolute score floor: if top result < threshold, return empty. Default: 0.3 */
  scoreFloor?: number
}

// ============================================================
// T1: Stop word filtering
// ============================================================

/**
 * Remove common stop words from a query string.
 * Returns the original query if all tokens are stop words (never returns empty).
 * Matches ByteRover behavior at search-knowledge-service.ts:291-295.
 */
export function filterStopWords(query: string): string {
  if (!query.trim()) return query

  const words = query.toLowerCase().split(/\s+/)
  const filtered = removeStopwords(words)

  return filtered.length > 0 ? filtered.join(' ') : query
}

// ============================================================
// T2: Absolute score floor gate
// ============================================================

/**
 * Drop all results if the best normalized score is below the threshold.
 * This is an absolute OOD (out-of-domain) gate.
 * Input may be sorted or unsorted — uses Math.max to find the best score.
 *
 * @param results - Results (sorted or unsorted)
 * @param threshold - Minimum acceptable top score
 * @returns Original results if best >= threshold, empty otherwise
 */
export function applyScoreFloor(results: NormalizedResult[], threshold: number): NormalizedResult[] {
  if (results.length === 0) return []
  // Use max score regardless of input order
  const topScore = Math.max(...results.map((r) => r.normalizedScore))

  return topScore >= threshold ? results : []
}

// ============================================================
// T3: Relative gap ratio filter
// ============================================================

/**
 * Keep only results whose score is >= topScore * ratio.
 * Sorts internally to find the true top score, then early-breaks on sorted input.
 * Matches ByteRover's gap filter pattern at search-knowledge-service.ts:1234-1242.
 *
 * @param results - Results (sorted or unsorted)
 * @param ratio - Gap ratio (0, 1]. Only results >= topScore * ratio are kept.
 * @returns Filtered results sorted descending by normalizedScore
 */
export function applyGapRatio(results: NormalizedResult[], ratio: number): NormalizedResult[] {
  if (results.length === 0) return []

  // Sort descending to find top score and enable early break
  const sorted = [...results].sort((a, b) => b.normalizedScore - a.normalizedScore)
  const floor = sorted[0].normalizedScore * ratio
  const filtered: NormalizedResult[] = []

  for (const r of sorted) {
    if (r.normalizedScore < floor) break
    filtered.push(r)
  }

  return filtered
}

// ============================================================
// Combined precision search
// ============================================================

/**
 * Execute a precision-filtered MiniSearch query combining T1/T2/T3:
 *
 * 1. Filter stop words from query (T1)
 * 2. Try AND for multi-word queries, fall back to OR if empty (T1)
 * 3. Normalize scores: score / (1 + score)
 * 4. Apply absolute score floor gate (T2)
 * 5. Apply relative gap ratio filter (T3)
 *
 * @param index - MiniSearch index to search
 * @param query - Raw query string
 * @param options - Precision search options
 * @returns Filtered, normalized results sorted descending by score
 */
export function searchWithPrecision<T>(
  index: MiniSearch<T>,
  query: string,
  options?: PrecisionSearchOptions,
): NormalizedResult[] {
  const {
    boost = {title: 2},
    fuzzy = 0.2,
    gapRatio = DEFAULT_GAP_RATIO,
    maxResults = 10,
    prefix = true,
    scoreFloor = DEFAULT_SCORE_FLOOR,
  } = options ?? {}

  // T1: Filter stop words
  const filteredQuery = filterStopWords(query)
  const words = filteredQuery.split(/\s+/).filter(Boolean)

  // T1: AND-first for multi-word queries, OR fallback
  const searchOpts = {boost, fuzzy, prefix}
  let rawResults

  if (words.length >= 2) {
    rawResults = index.search(filteredQuery, {combineWith: 'AND', ...searchOpts})
    if (rawResults.length === 0) {
      rawResults = index.search(filteredQuery, {combineWith: 'OR', ...searchOpts})
    }
  } else {
    rawResults = index.search(filteredQuery, {combineWith: 'OR', ...searchOpts})
  }

  // Cap candidate set by MiniSearch rank order before applying T2/T3.
  // This limits the precision pipeline to the top-N MiniSearch hits.
  const normalized: NormalizedResult[] = rawResults.slice(0, maxResults).map((r) => ({
    id: r.id,
    normalizedScore: r.score / (1 + r.score),
    queryTerms: (r as unknown as {queryTerms: string[]}).queryTerms ?? [],
    rawScore: r.score,
  }))

  // T2: Absolute score floor
  const afterFloor = applyScoreFloor(normalized, scoreFloor)
  if (afterFloor.length === 0) return []

  // T3: Relative gap ratio
  return applyGapRatio(afterFloor, gapRatio)
}
