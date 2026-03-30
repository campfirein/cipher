import {
  EXPERIENCE_DEAD_ENDS_DIR,
  EXPERIENCE_HINTS_DIR,
  EXPERIENCE_LESSONS_DIR,
  EXPERIENCE_PERFORMANCE_DIR,
  EXPERIENCE_REFLECTIONS_DIR,
  EXPERIENCE_STRATEGIES_DIR,
} from '../../../constants.js'

// ---------------------------------------------------------------------------
// Signal types
// ---------------------------------------------------------------------------

export type ExperienceSignalType = 'dead-end' | 'hint' | 'lesson' | 'performance' | 'reflection' | 'strategy'

/** Signal types that participate in backpressure gate evaluation and cadence-based synthesis. */
export const STANDARD_SIGNAL_TYPES: readonly ExperienceSignalType[] = ['dead-end', 'hint', 'lesson', 'strategy']

// ---------------------------------------------------------------------------
// Signal → subfolder mapping
// ---------------------------------------------------------------------------

const SIGNAL_SUBFOLDER_MAP: Record<ExperienceSignalType, string> = {
  'dead-end': EXPERIENCE_DEAD_ENDS_DIR,
  hint: EXPERIENCE_HINTS_DIR,
  lesson: EXPERIENCE_LESSONS_DIR,
  performance: EXPERIENCE_PERFORMANCE_DIR,
  reflection: EXPERIENCE_REFLECTIONS_DIR,
  strategy: EXPERIENCE_STRATEGIES_DIR,
}

/** Return the experience subfolder for a given signal type. */
export function signalTypeToSubfolder(type: ExperienceSignalType): string {
  return SIGNAL_SUBFOLDER_MAP[type]
}

// ---------------------------------------------------------------------------
// Entry frontmatter
// ---------------------------------------------------------------------------

export interface ExperienceEntryFrontmatter {
  confidence?: string
  contentHash: string
  createdAt: string
  derived_from?: string[]
  importance: number
  maturity: 'core' | 'draft' | 'validated'
  recency: number
  tags: string[]
  title: string
  type: ExperienceSignalType
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Performance log
// ---------------------------------------------------------------------------

export interface PerformanceLogEntry {
  curationId: number
  domain: string
  score: number
  summary: string
  ts: string
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export interface ExperienceMeta {
  curationCount: number
  lastConsolidatedAt: string
}
