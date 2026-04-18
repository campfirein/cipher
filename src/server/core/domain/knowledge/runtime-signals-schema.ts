/**
 * Runtime signals — per-machine ranking fields that live in a sidecar store
 * rather than in shared context-tree markdown frontmatter.
 *
 * These fields change on every query (access hit flush) and would otherwise
 * dirty version control state and cause merge conflicts across teammates.
 *
 * Related: `features/runtime-signals/plan.md`
 */

import {z} from 'zod'

// ---------------------------------------------------------------------------
// Defaults (used when a path has no sidecar entry yet)
// ---------------------------------------------------------------------------

export const DEFAULT_IMPORTANCE = 50
export const DEFAULT_RECENCY = 1
export const DEFAULT_MATURITY = 'draft' as const
export const DEFAULT_ACCESS_COUNT = 0
export const DEFAULT_UPDATE_COUNT = 0

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const MaturityTierSchema = z.enum(['core', 'draft', 'validated'])

export const RuntimeSignalsSchema = z.object({
  accessCount: z.number().int().nonnegative().default(DEFAULT_ACCESS_COUNT),
  importance: z.number().min(0).max(100).default(DEFAULT_IMPORTANCE),
  maturity: MaturityTierSchema.default(DEFAULT_MATURITY),
  recency: z.number().min(0).max(1).default(DEFAULT_RECENCY),
  updateCount: z.number().int().nonnegative().default(DEFAULT_UPDATE_COUNT),
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MaturityTier = z.infer<typeof MaturityTierSchema>
export type RuntimeSignals = z.infer<typeof RuntimeSignalsSchema>

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Return a fresh RuntimeSignals with default values.
 * Used by the sidecar store when a path has no entry yet, and by curate ADD
 * when seeding a new knowledge file.
 */
export function createDefaultRuntimeSignals(): RuntimeSignals {
  return {
    accessCount: DEFAULT_ACCESS_COUNT,
    importance: DEFAULT_IMPORTANCE,
    maturity: DEFAULT_MATURITY,
    recency: DEFAULT_RECENCY,
    updateCount: DEFAULT_UPDATE_COUNT,
  }
}
