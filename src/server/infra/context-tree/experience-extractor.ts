import {MultiStrategyParser} from '../../../agent/infra/llm/parsing/multi-strategy-parser.js'
import {
  EXPERIENCE_DEAD_ENDS_FILE,
  EXPERIENCE_HINTS_FILE,
  EXPERIENCE_LESSONS_FILE,
  EXPERIENCE_PLAYBOOK_FILE,
} from '../../constants.js'
import {EXPERIENCE_SECTIONS} from './experience-store.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExperienceSignalType = 'dead-end' | 'hint' | 'lesson' | 'strategy'

export interface ExperienceSignal {
  text: string
  type: ExperienceSignalType
}

/** Maps a signal type to its target file and section header. */
export interface SignalTarget {
  file: string
  section: string
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const SIGNAL_TYPE_MAP: Record<ExperienceSignalType, SignalTarget> = {
  'dead-end': {
    file: EXPERIENCE_DEAD_ENDS_FILE,
    section: EXPERIENCE_SECTIONS[EXPERIENCE_DEAD_ENDS_FILE],
  },
  hint: {
    file: EXPERIENCE_HINTS_FILE,
    section: EXPERIENCE_SECTIONS[EXPERIENCE_HINTS_FILE],
  },
  lesson: {
    file: EXPERIENCE_LESSONS_FILE,
    section: EXPERIENCE_SECTIONS[EXPERIENCE_LESSONS_FILE],
  },
  strategy: {
    file: EXPERIENCE_PLAYBOOK_FILE,
    section: EXPERIENCE_SECTIONS[EXPERIENCE_PLAYBOOK_FILE],
  },
}

const VALID_TYPES = new Set<string>(['dead-end', 'hint', 'lesson', 'strategy'])

/** Parser for extracting signal arrays from fence body when JSON.parse fails. */
const experienceBodyParser = new MultiStrategyParser<ExperienceSignal[]>({
  enabledTiers: ['raw-json'],
  validator: (v): v is ExperienceSignal[] => Array.isArray(v) && v.every((item) => isValidSignal(item)),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidSignal(value: unknown): value is ExperienceSignal {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    VALID_TYPES.has(obj.type as string) &&
    typeof obj.text === 'string' &&
    obj.text.trim().length > 0
  )
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
 * Example block the agent is expected to emit:
 * ```experience
 * [{"type":"lesson","text":"Always call ensureInitialized before appendBulkToFile"}]
 * ```
 */
export function extractExperienceSignals(curateResponse: string): ExperienceSignal[] {
  try {
    const match = /```experience\r?\n([\s\S]*?)\r?\n```/.exec(curateResponse)
    if (!match) {
      return []
    }

    const body = match[1]

    // Try direct JSON.parse first (current behavior)
    try {
      const parsed: unknown = JSON.parse(body)
      if (Array.isArray(parsed)) {
        return parsed.filter((v) => isValidSignal(v))
      }
    } catch {
      // JSON parse failed on fence body — fall through to parser
    }

    // Fallback: use MultiStrategyParser on the fence body only (not full response).
    // Handles malformed JSON inside the fence (extra whitespace, trailing commas).
    const result = experienceBodyParser.parse(body)

    return result ? result.parsed.filter((v) => isValidSignal(v)) : []
  } catch {
    return []
  }
}

/**
 * Return the target file and section for a given signal type.
 */
export function signalTarget(type: ExperienceSignalType): SignalTarget {
  return SIGNAL_TYPE_MAP[type]
}
