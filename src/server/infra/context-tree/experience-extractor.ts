import {MultiStrategyParser} from '../../../agent/infra/llm/parsing/multi-strategy-parser.js'
import {type ExperienceSignalType} from '../../core/domain/experience/experience-types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExperienceSignal {
  text: string
  type: ExperienceSignalType
}

export interface ExperiencePerformanceSignal extends ExperienceSignal {
  domain: string
  score: number
  type: 'performance'
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set<string>(['dead-end', 'hint', 'lesson', 'performance', 'reflection', 'strategy'])

/** Parser for extracting signal arrays from fence body when JSON.parse fails. */
const experienceBodyParser = new MultiStrategyParser<Array<ExperiencePerformanceSignal | ExperienceSignal>>({
  enabledTiers: ['raw-json'],
  validator: (v): v is Array<ExperiencePerformanceSignal | ExperienceSignal> =>
    Array.isArray(v) && v.every((item) => isValidSignal(item)),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidSignal(value: unknown): value is ExperiencePerformanceSignal | ExperienceSignal {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>

  if (!VALID_TYPES.has(obj.type as string)) return false
  if (typeof obj.text !== 'string' || obj.text.trim().length === 0) return false

  // Performance signals require score and domain
  if (obj.type === 'performance') {
    if (typeof obj.score !== 'number' || obj.score < 0 || obj.score > 1) return false
    if (typeof obj.domain !== 'string' || obj.domain.trim().length === 0) return false
  }

  return true
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract experience signals from a curation agent response.
 *
 * Looks for a fenced ```experience block containing a JSON array of
 * {type, text} objects. Returns an empty array on any parse error or
 * absent block — extraction is always fail-safe.
 *
 * Supported types: lesson, hint, dead-end, strategy, performance, reflection.
 * Performance signals additionally require score (0-1) and domain fields.
 */
export function extractExperienceSignals(curateResponse: string): Array<ExperiencePerformanceSignal | ExperienceSignal> {
  try {
    const match = /```experience\r?\n([\s\S]*?)\r?\n```/.exec(curateResponse)
    if (!match) {
      return []
    }

    const body = match[1]

    // Try direct JSON.parse first
    try {
      const parsed: unknown = JSON.parse(body)
      if (Array.isArray(parsed)) {
        return parsed.filter((v) => isValidSignal(v))
      }
    } catch {
      // JSON parse failed on fence body — fall through to parser
    }

    // Fallback: use MultiStrategyParser on the fence body only
    const result = experienceBodyParser.parse(body)

    return result ? result.parsed.filter((v) => isValidSignal(v)) : []
  } catch {
    return []
  }
}
