/**
 * FinMem-inspired memory scoring engine for knowledge lifecycle management.
 *
 * Provides pure functions for:
 * - Compound scoring (BM25 relevance + importance + recency)
 * - Exponential decay of importance and recency over time
 * - Maturity tier determination with hysteresis (draft -> validated -> core)
 * - Feedback recording (search access hits, curate updates)
 *
 * All functions are stateless and side-effect free.
 */

import type {FrontmatterScoring} from './markdown-writer.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Days for recency half-life (~21 days to halve) */
export const DECAY_RECENCY_FACTOR = 30

/** Per-day importance multiplier (~78% after 50 days of non-use) */
export const DECAY_IMPORTANCE_FACTOR = 0.995

/** Importance bonus per search hit */
export const ACCESS_IMPORTANCE_BONUS = 3

/** Importance bonus per curate update */
export const UPDATE_IMPORTANCE_BONUS = 5

/** BM25 relevance weight in compound score */
export const W_RELEVANCE = 0.6

/** Importance weight in compound score */
export const W_IMPORTANCE = 0.25

/** Recency weight in compound score */
export const W_RECENCY = 0.15

/** Importance threshold to promote draft -> validated */
export const PROMOTE_TO_VALIDATED = 65

/** Importance threshold to promote validated -> core */
export const PROMOTE_TO_CORE = 85

/** Importance threshold to demote core -> validated (hysteresis gap) */
export const DEMOTE_FROM_CORE = 60

/** Importance threshold to demote validated -> draft (hysteresis gap) */
export const DEMOTE_FROM_VALIDATED = 35

/** Search score multiplier per maturity tier */
export const TIER_BOOST: Record<string, number> = {
  core: 1.15,
  draft: 1,
  validated: 1.08,
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Compute compound score for retrieval ranking.
 *
 * Combines BM25 text relevance with importance and recency signals,
 * then applies a tier-based boost.
 *
 * @param bm25Normalized - Normalized BM25 score in [0, 1)
 * @param importance - Importance score in [0, 100]
 * @param recency - Recency score in [0, 1]
 * @param maturity - Maturity tier ('draft' | 'validated' | 'core')
 * @returns Compound score (typically in [0, ~1.15])
 */
export function compoundScore(
  bm25Normalized: number,
  importance: number,
  recency: number,
  maturity: string,
): number {
  const normalizedImportance = Math.min(importance, 100) / 100
  const base = W_RELEVANCE * bm25Normalized + W_IMPORTANCE * normalizedImportance + W_RECENCY * recency
  const boost = TIER_BOOST[maturity] ?? TIER_BOOST.draft

  return base * boost
}

/**
 * Apply time-based exponential decay to scoring fields.
 *
 * Recency decays as exp(-days / DECAY_RECENCY_FACTOR).
 * Importance decays as importance * DECAY_IMPORTANCE_FACTOR^days.
 *
 * @param scoring - Current scoring state
 * @param daysSinceLastUpdate - Days since the file was last updated
 * @returns New scoring with decayed values (original not mutated)
 */
export function applyDecay(scoring: FrontmatterScoring, daysSinceLastUpdate: number): FrontmatterScoring {
  if (daysSinceLastUpdate <= 0) {
    return scoring
  }

  const currentImportance = scoring.importance ?? 50
  const newRecency = Math.exp(-daysSinceLastUpdate / DECAY_RECENCY_FACTOR)
  const newImportance = currentImportance * DECAY_IMPORTANCE_FACTOR ** daysSinceLastUpdate

  return {
    ...scoring,
    importance: Math.max(0, newImportance),
    recency: newRecency,
  }
}

/**
 * Determine the maturity tier based on importance score.
 *
 * Uses hysteresis to prevent rapid oscillation between tiers:
 * - Promote draft -> validated at importance >= 65
 * - Promote validated -> core at importance >= 85
 * - Demote core -> validated at importance < 60
 * - Demote validated -> draft at importance < 35
 *
 * @param importance - Current importance score
 * @param currentTier - Current maturity tier
 * @returns The determined tier
 */
export function determineTier(
  importance: number,
  currentTier: 'core' | 'draft' | 'validated',
): 'core' | 'draft' | 'validated' {
  // Promotion
  if (importance >= PROMOTE_TO_CORE) {
    return 'core'
  }

  if (importance >= PROMOTE_TO_VALIDATED && currentTier === 'draft') {
    return 'validated'
  }

  // Demotion (with hysteresis gap)
  if (currentTier === 'core' && importance < DEMOTE_FROM_CORE) {
    return 'validated'
  }

  if (currentTier === 'validated' && importance < DEMOTE_FROM_VALIDATED) {
    return 'draft'
  }

  return currentTier
}

/**
 * Record a search access hit on a knowledge file.
 *
 * Increments access count and adds an importance bonus.
 *
 * @param scoring - Current scoring state
 * @returns Updated scoring (original not mutated)
 */
export function recordAccessHit(scoring: FrontmatterScoring): FrontmatterScoring {
  const newAccessCount = (scoring.accessCount ?? 0) + 1
  const newImportance = Math.min(100, (scoring.importance ?? 50) + ACCESS_IMPORTANCE_BONUS)

  return {
    ...scoring,
    accessCount: newAccessCount,
    importance: newImportance,
  }
}

/**
 * Record multiple accumulated access hits at once.
 *
 * @param scoring - Current scoring state
 * @param hitCount - Number of hits to record
 * @returns Updated scoring (original not mutated)
 */
export function recordAccessHits(scoring: FrontmatterScoring, hitCount: number): FrontmatterScoring {
  if (hitCount <= 0) {
    return scoring
  }

  const newAccessCount = (scoring.accessCount ?? 0) + hitCount
  const newImportance = Math.min(100, (scoring.importance ?? 50) + ACCESS_IMPORTANCE_BONUS * hitCount)

  return {
    ...scoring,
    accessCount: newAccessCount,
    importance: newImportance,
  }
}

/**
 * Record a curate update on a knowledge file.
 *
 * Increments update count, adds an importance bonus, resets recency to 1.0,
 * and updates the timestamp.
 *
 * @param scoring - Current scoring state
 * @returns Updated scoring (original not mutated)
 */
export function recordCurateUpdate(scoring: FrontmatterScoring): FrontmatterScoring {
  const newUpdateCount = (scoring.updateCount ?? 0) + 1
  const newImportance = Math.min(100, (scoring.importance ?? 50) + UPDATE_IMPORTANCE_BONUS)
  const now = new Date().toISOString()

  return {
    ...scoring,
    importance: newImportance,
    recency: 1,
    updateCount: newUpdateCount,
    updatedAt: now,
  }
}

/**
 * Return default scoring values for a new or unscored knowledge file.
 */
export function applyDefaultScoring(): FrontmatterScoring {
  const now = new Date().toISOString()

  return {
    accessCount: 0,
    createdAt: now,
    importance: 50,
    maturity: 'draft',
    recency: 1,
    updateCount: 0,
    updatedAt: now,
  }
}

/**
 * Merge two scoring states during a MERGE operation.
 *
 * Strategy:
 * - importance: max of both
 * - recency: max of both
 * - accessCount: sum
 * - updateCount: sum + 1 (for the merge itself)
 * - maturity: higher tier
 * - createdAt: earlier date
 * - updatedAt: current time
 */
export function mergeScoring(
  source: FrontmatterScoring,
  target: FrontmatterScoring,
): FrontmatterScoring {
  const tierRank: Record<string, number> = {core: 3, draft: 1, validated: 2}
  const sourceRank = tierRank[source.maturity ?? 'draft'] ?? 1
  const targetRank = tierRank[target.maturity ?? 'draft'] ?? 1
  const higherTier = sourceRank >= targetRank
    ? (source.maturity ?? 'draft')
    : (target.maturity ?? 'draft')

  const sourceCreated = source.createdAt ? new Date(source.createdAt).getTime() : Date.now()
  const targetCreated = target.createdAt ? new Date(target.createdAt).getTime() : Date.now()

  return {
    accessCount: (source.accessCount ?? 0) + (target.accessCount ?? 0),
    createdAt: sourceCreated <= targetCreated ? source.createdAt : target.createdAt,
    importance: Math.max(source.importance ?? 50, target.importance ?? 50),
    maturity: higherTier as 'core' | 'draft' | 'validated',
    recency: Math.max(source.recency ?? 1, target.recency ?? 1),
    updateCount: (source.updateCount ?? 0) + (target.updateCount ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }
}
