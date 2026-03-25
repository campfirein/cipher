/**
 * Query feedback collector — converts query execution outcomes into
 * HarnessFeedback entries for Thompson sampling updates.
 *
 * Feedback rules:
 * - directHit (Tier 2) → success for all nodes
 * - prefetched (Tier 3) → partial (alpha=0.7, beta=0.3 via recordOutcomeF1)
 * - no prefetch (Tier 4) → failure for all nodes
 * - supplemented → decomposition miss (failure for decompose node)
 * - ood (out-of-domain) → empty array (not a search quality signal)
 */

import type {HarnessFeedback} from '../../../core/interfaces/harness/i-harness-feedback.js'

// ── Types ───────────────────────────────────────────────────────────────────

export interface QueryOutcome {
  /** Tier 2 responded directly */
  directHit: boolean
  /** Out-of-domain — skip feedback (not a search quality signal) */
  ood: boolean
  /** Had pre-fetched context (Tier 3) */
  prefetched: boolean
  /** Supplementary searches were triggered */
  supplemented: boolean
  /** Which tier responded (0-4) */
  tier: number
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build feedback entries from a query execution outcome.
 *
 * Returns one HarnessFeedback entry per non-null node ID.
 *
 * @param nodeIds - Selected node IDs for each sub-harness (may be undefined)
 * @param outcome - Query execution outcome signals
 * @returns Array of feedback entries (empty for OOD queries)
 */
export function buildQueryFeedback(
  nodeIds: {boost?: string; decompose?: string; rerank?: string},
  outcome: QueryOutcome,
): HarnessFeedback[] {
  // Out-of-domain queries produce no feedback signal
  if (outcome.ood) {
    return []
  }

  const now = Date.now()
  const entries: HarnessFeedback[] = []

  // Determine success/failure based on outcome signals
  const isDirectHit = outcome.directHit
  const isPrefetched = outcome.prefetched

  for (const [role, nodeId] of Object.entries(nodeIds) as Array<[string, string | undefined]>) {
    if (!nodeId) continue

    let success: boolean
    if (isDirectHit) {
      // Tier 2 direct hit → success for all nodes
      success = true
    } else if (isPrefetched) {
      // Tier 3 prefetched → partial success (caller should use recordOutcomeF1
      // with alpha=0.7, beta=0.3 instead of binary recordOutcome)
      success = true
    } else {
      // Tier 4+ fallback → failure for all nodes
      success = false
    }

    // Supplemented means decomposition missed relevant terms
    if (outcome.supplemented && role === 'decompose') {
      success = false
    }

    entries.push({
      details: {
        directHit: outcome.directHit,
        prefetched: outcome.prefetched,
        role,
        supplemented: outcome.supplemented,
        tier: outcome.tier,
      },
      nodeId,
      success,
      timestamp: now,
    })
  }

  return entries
}
