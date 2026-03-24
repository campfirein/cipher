/**
 * Feedback collector for reorg harness — converts reorg execution
 * results into quality-based feedback for Thompson sampling updates.
 *
 * Quality scoring trains detector accuracy (correct candidate selection),
 * not just executor safety (operation succeeded). Uses qualityMetrics from
 * ReorgResult to measure whether the operation actually improved the tree.
 */

import type {ReorgResult} from '../../../core/interfaces/executor/i-reorg-executor.js'
import type {HarnessFeedback} from '../../../core/interfaces/harness/i-harness-feedback.js'

/**
 * Compute quality score for a single merge result.
 *
 * A merge is high-quality if it reduced keyword duplication:
 * quality = 1 - (postKeywordCount / preKeywordCount)
 * If post < pre, keywords were deduplicated → quality > 0.
 * If post == pre, no dedup happened → quality = 0 (merge was pointless).
 */
function scoreMergeQuality(result: ReorgResult): number {
  if (!result.success) return 0
  const metrics = result.qualityMetrics
  if (!metrics?.preKeywordCount || !metrics.postKeywordCount) return result.success ? 0.5 : 0

  if (metrics.preKeywordCount === 0) return 0.5 // no keywords to compare
  const reduction = 1 - (metrics.postKeywordCount / metrics.preKeywordCount)

  // reduction > 0 means dedup happened. Clamp to [0, 1].
  return Math.max(0, Math.min(1, reduction > 0 ? 0.5 + reduction : reduction * 2))
}

/**
 * Compute quality score for a single move result.
 *
 * A move is high-quality if domain alignment improved:
 * quality = postDomainAlignment - preDomainAlignment
 * Clamped to [0, 1]. Positive = better classification after move.
 */
function scoreMoveQuality(result: ReorgResult): number {
  if (!result.success) return 0
  const metrics = result.qualityMetrics
  if (metrics?.postDomainAlignment === undefined || metrics.preDomainAlignment === undefined) {
    return result.success ? 0.5 : 0 // no alignment data — neutral
  }

  const improvement = metrics.postDomainAlignment - metrics.preDomainAlignment

  return Math.max(0, Math.min(1, improvement > 0 ? 0.5 + improvement / 2 : 0))
}

/**
 * Build quality-based feedback from reorg results.
 *
 * Returns { feedback, alpha, beta } for recordOutcomeF1():
 * - alpha = average quality score across all operations
 * - beta = 1 - alpha
 *
 * Quality is measured by actual tree improvement, not just execution success:
 * - merge: did keyword deduplication actually reduce overlap?
 * - move: did domain alignment actually improve?
 *
 * Returns null if no operations were executed (neutral signal — no update).
 */
export function buildReorgFeedback(
  nodeId: string,
  results: ReorgResult[],
): null | {alpha: number; beta: number; feedback: HarnessFeedback} {
  if (results.length === 0) return null

  // Compute per-result quality scores
  const scores = results.map((r) => {
    switch (r.candidate.type) {
      case 'merge': {
        return scoreMergeQuality(r)
      }

      case 'move': {
        return scoreMoveQuality(r)
      }

      default: {
        return r.success ? 0.5 : 0
      }
    }
  })

  // Average quality across all operations
  const quality = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

  const mergeResults = results.filter((r) => r.candidate.type === 'merge')
  const moveResults = results.filter((r) => r.candidate.type === 'move')

  const feedback: HarnessFeedback = {
    details: {
      averageQuality: quality,
      failedMerges: mergeResults.filter((r) => !r.success).length,
      failedMoves: moveResults.filter((r) => !r.success).length,
      scores,
      successfulMerges: mergeResults.filter((r) => r.success).length,
      successfulMoves: moveResults.filter((r) => r.success).length,
      total: results.length,
    },
    nodeId,
    success: quality > 0.5,
    timestamp: Date.now(),
  }

  return {alpha: quality, beta: 1 - quality, feedback}
}
