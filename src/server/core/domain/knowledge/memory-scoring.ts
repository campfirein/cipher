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

import type {RuntimeSignals} from './runtime-signals-schema.js'

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
export const W_IMPORTANCE = 0.2

/** Recency weight in compound score */
export const W_RECENCY = 0.2

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
  draft: 0.85,
  validated: 1,
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
 * @param signals - RuntimeSignals snapshot (importance, recency, maturity)
 * @returns Compound score (typically in [0, ~1.15])
 */
export function compoundScore(bm25Normalized: number, signals: RuntimeSignals): number {
  const normalizedImportance = Math.min(signals.importance, 100) / 100
  const base = W_RELEVANCE * bm25Normalized + W_IMPORTANCE * normalizedImportance + W_RECENCY * signals.recency
  const boost = TIER_BOOST[signals.maturity] ?? TIER_BOOST.draft

  return base * boost
}

/**
 * Apply time-based exponential decay to a signals snapshot.
 *
 * Recency decays as exp(-days / DECAY_RECENCY_FACTOR).
 * Importance decays as importance * DECAY_IMPORTANCE_FACTOR^days.
 *
 * @param signals - Current RuntimeSignals snapshot
 * @param daysSinceLastUpdate - Days since the file was last updated
 * @returns New signals with decayed values (original not mutated)
 */
export function applyDecay(signals: RuntimeSignals, daysSinceLastUpdate: number): RuntimeSignals {
  if (daysSinceLastUpdate <= 0) {
    return signals
  }

  const newRecency = Math.exp(-daysSinceLastUpdate / DECAY_RECENCY_FACTOR)
  const newImportance = signals.importance * DECAY_IMPORTANCE_FACTOR ** daysSinceLastUpdate

  return {
    ...signals,
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
 * Record multiple accumulated access hits at once.
 *
 * Increments accessCount by `hitCount` and importance by
 * `ACCESS_IMPORTANCE_BONUS * hitCount` (capped at 100). Caller is
 * responsible for recomputing maturity via `determineTier` if the
 * importance delta may cross a hysteresis threshold.
 */
export function recordAccessHits(signals: RuntimeSignals, hitCount: number): RuntimeSignals {
  if (hitCount <= 0) {
    return signals
  }

  return {
    ...signals,
    accessCount: signals.accessCount + hitCount,
    importance: Math.min(100, signals.importance + ACCESS_IMPORTANCE_BONUS * hitCount),
  }
}

/**
 * Record a curate update on a knowledge file.
 *
 * Increments updateCount, adds an importance bonus, resets recency to 1.0.
 * Caller is responsible for recomputing maturity via `determineTier`.
 */
export function recordCurateUpdate(signals: RuntimeSignals): RuntimeSignals {
  return {
    ...signals,
    importance: Math.min(100, signals.importance + UPDATE_IMPORTANCE_BONUS),
    recency: 1,
    updateCount: signals.updateCount + 1,
  }
}

/**
 * Merge two runtime-signal snapshots during a MERGE operation.
 *
 * Strategy:
 * - importance: max of both
 * - recency: max of both
 * - accessCount: sum
 * - updateCount: sum + 1 (for the merge itself)
 * - maturity: higher tier (caller may refine via `determineTier`)
 */
export function mergeScoring(source: RuntimeSignals, target: RuntimeSignals): RuntimeSignals {
  const tierRank: Record<string, number> = {core: 3, draft: 1, validated: 2}
  const sourceRank = tierRank[source.maturity] ?? 1
  const targetRank = tierRank[target.maturity] ?? 1
  const higherTier = sourceRank >= targetRank ? source.maturity : target.maturity

  return {
    accessCount: source.accessCount + target.accessCount,
    importance: Math.max(source.importance, target.importance),
    maturity: higherTier,
    recency: Math.max(source.recency, target.recency),
    updateCount: source.updateCount + target.updateCount + 1,
  }
}
