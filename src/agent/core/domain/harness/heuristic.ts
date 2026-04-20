/**
 * AutoHarness V2 — heuristic H.
 *
 * Pure function that turns a list of `CodeExecOutcome` records into the
 * scalar H consumed by the mode selector (Phase 5) and the refinement
 * evaluator (Phase 6).
 *
 * H = 0.2·successRate + 0.3·(1 − errorRate) + 0.5·realHarnessRate
 *
 * where each rate is a recency-weighted fraction over the most recent
 * `WINDOW_SIZE` outcomes, and weight(o) = exp(−ageDays(o) / DECAY_HALF_LIFE_DAYS).
 *
 * `realHarnessRate` carries the highest weight so the pass-through cap
 * works: a window of `delegated:true` outcomes (LLM doing all the work
 * through the harness sandbox) yields H ≤ 0.55 regardless of success,
 * preventing Option C templates from graduating to Mode B/C without real
 * refinement generating `!delegated` outcomes. See
 * `features/autoharness-v2/analysis/v1-design-decisions.md §2.1`.
 *
 * Pure function — `now` is passed in, not read from `Date`. Mirrors the
 * pattern used by `src/server/core/domain/knowledge/memory-scoring.ts`.
 */

import type {CodeExecOutcome} from './types.js'

/** Weight applied to successRate in H. */
const W_SUCCESS = 0.2

/** Weight applied to (1 − errorRate) in H. */
const W_ERROR = 0.3

/** Weight applied to realHarnessRate in H. */
const W_REAL_HARNESS = 0.5

/** Cap the window at the most-recent N outcomes before computing H. */
const WINDOW_SIZE = 50

/** Below this many outcomes, H is not computable — caller treats as "unknown". */
const MIN_SAMPLE_FLOOR = 10

/** Recency half-life in days. 30 → 30-day-old outcomes contribute ~50% weight. */
const DECAY_HALF_LIFE_DAYS = 30

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Compute the heuristic H from a list of outcomes.
 *
 * Returns `null` when the input cannot support a meaningful H:
 *   - fewer than `MIN_SAMPLE_FLOOR` outcomes (caller should treat as
 *     "not computed yet", NOT as H=0), OR
 *   - the sum of recency weights rounds to 0 (defensive — unreachable
 *     with finite valid outcomes at realistic timestamps, but guards
 *     against bugs upstream).
 *
 * `errorRate` reads `stderr` only; non-empty stderr signals tool/code
 * friction even on eventual success. The schema has no `error` field.
 *
 * The final H is clamped to `[0, 1]`. Clamp is defensive: future-dated
 * outcomes produce weights > 1 (`ageDays < 0` ⇒ `exp(positive) > 1`),
 * which doesn't break the weighted-average math but can push the raw
 * sum slightly out of range.
 */
export function computeHeuristic(
  outcomes: readonly CodeExecOutcome[],
  now: number,
): null | number {
  if (outcomes.length < MIN_SAMPLE_FLOOR) return null

  const window = [...outcomes]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, WINDOW_SIZE)

  let sumWeight = 0
  let sumSuccess = 0
  let sumError = 0
  let sumRealHarness = 0

  for (const o of window) {
    const ageDays = (now - o.timestamp) / MS_PER_DAY
    const weight = Math.exp(-ageDays / DECAY_HALF_LIFE_DAYS)

    sumWeight += weight
    if (o.success) sumSuccess += weight
    if (o.stderr && o.stderr.length > 0) sumError += weight
    // `=== false` (not `!o.delegated`) so an outcome with `delegated`
    // omitted is NOT silently counted as real harness work. Missing
    // means "the recorder didn't say" — we require an affirmative
    // `delegated: false` before crediting realHarnessRate.
    if (o.usedHarness && o.delegated === false) sumRealHarness += weight
  }

  if (sumWeight === 0) return null

  const successRate = sumSuccess / sumWeight
  const errorRate = sumError / sumWeight
  const realHarnessRate = sumRealHarness / sumWeight

  const h =
    W_SUCCESS * successRate +
    W_ERROR * (1 - errorRate) +
    W_REAL_HARNESS * realHarnessRate

  return Math.max(0, Math.min(1, h))
}
