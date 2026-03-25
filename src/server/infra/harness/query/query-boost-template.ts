/**
 * Query boost template — adjusts compound scores AFTER MiniSearch returns
 * results via post-search re-scoring.
 *
 * MiniSearch boost weights are static (set at index build time).
 * Dynamic boosting uses post-search score adjustments, not per-call options.
 *
 * Pure computation, no I/O. Must complete in < 5ms.
 */

import {load as yamlLoad} from 'js-yaml'

import type {SearchKnowledgeResult} from '../../../../agent/infra/sandbox/tools-sdk.js'

// ── Types ───────────────────────────────────────────────────────────────────

export interface BoostAdjustments {
  /** Bonus per backlink on a result */
  crossReferenceBonus: number
  /** Bonus when result domain matches a query domain hint */
  domainMatchBonus: number
  /** Bonus when result title contains query terms */
  titleMatchBonus: number
}

interface BoostTemplate {
  scoreAdjustments?: Partial<BoostAdjustments>
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_ADJUSTMENTS: BoostAdjustments = {
  crossReferenceBonus: 0,
  domainMatchBonus: 0,
  titleMatchBonus: 0,
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse YAML template and extract boost adjustments.
 *
 * @param templateContent - YAML with `scoreAdjustments` section
 * @returns Parsed adjustments with defaults for missing fields
 */
export function computeBoostAdjustments(templateContent: string): BoostAdjustments {
  let template: BoostTemplate
  try {
    template = (yamlLoad(templateContent) as BoostTemplate) ?? {}
  } catch {
    return {...DEFAULT_ADJUSTMENTS}
  }

  const raw = template.scoreAdjustments ?? {}

  return {
    crossReferenceBonus: typeof raw.crossReferenceBonus === 'number' ? raw.crossReferenceBonus : DEFAULT_ADJUSTMENTS.crossReferenceBonus,
    domainMatchBonus: typeof raw.domainMatchBonus === 'number' ? raw.domainMatchBonus : DEFAULT_ADJUSTMENTS.domainMatchBonus,
    titleMatchBonus: typeof raw.titleMatchBonus === 'number' ? raw.titleMatchBonus : DEFAULT_ADJUSTMENTS.titleMatchBonus,
  }
}

/**
 * Apply post-search boost adjustments to results and re-sort by score.
 * Returns a new array with copied result objects — does not mutate inputs.
 *
 * Adjustments:
 * - Domain match bonus: applied when result's symbolPath contains a domain hint
 * - Title match bonus: applied when result title contains any query term
 * - Cross-reference bonus: applied per backlink count
 * - All scores clamped to [0, 0.9999] to prevent false Tier-2 direct hits
 */
export function applyBoostAdjustments(
  results: SearchKnowledgeResult['results'],
  adjustments: BoostAdjustments,
  query: string,
  domainHints: string[],
): SearchKnowledgeResult['results'] {
  const queryTermsLower = query.toLowerCase().split(/\s+/).filter(Boolean)
  const domainHintsLower = domainHints.map((d) => d.toLowerCase())

  const adjusted = results.map((result) => {
    let delta = 0

    // Domain match bonus
    if (adjustments.domainMatchBonus !== 0 && result.symbolPath) {
      const symbolPathLower = result.symbolPath.toLowerCase()
      if (domainHintsLower.some((hint) => symbolPathLower.includes(hint))) {
        delta += adjustments.domainMatchBonus
      }
    }

    // Title match bonus
    if (adjustments.titleMatchBonus !== 0) {
      const titleLower = result.title.toLowerCase()
      if (queryTermsLower.some((term) => titleLower.includes(term))) {
        delta += adjustments.titleMatchBonus
      }
    }

    // Cross-reference bonus
    if (adjustments.crossReferenceBonus !== 0 && result.backlinkCount) {
      delta += adjustments.crossReferenceBonus * result.backlinkCount
    }

    return {...result, score: Math.max(0, Math.min(0.9999, result.score + delta))}
  })

  // Sort descending by score
  adjusted.sort((a, b) => b.score - a.score)

  return adjusted
}
