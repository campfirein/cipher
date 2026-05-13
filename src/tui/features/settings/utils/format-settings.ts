import type {SettingsItemDTO} from '../../../../shared/transport/events/settings-events.js'

export interface SettingsRow {
  readonly current: number
  readonly default: number
  readonly description: string
  readonly displayCurrent: string
  readonly displayDefault: string
  readonly key: string
  readonly label: string
  readonly max: number
  readonly min: number
  readonly modified: boolean
  readonly restartRequired: true
  readonly type: 'integer'
}

/**
 * Returns rows in the registry's natural order with pre-formatted display
 * columns. `modified` is true when the current value differs from the
 * registered default (used by the page to highlight rows the user has
 * touched).
 */
export function buildSettingsRows(items: readonly SettingsItemDTO[]): SettingsRow[] {
  return items.map((item) => ({
    current: item.current,
    default: item.default,
    description: item.description,
    displayCurrent: String(item.current),
    displayDefault: String(item.default),
    key: item.key,
    label: item.key,
    max: item.max,
    min: item.min,
    modified: item.current !== item.default,
    restartRequired: item.restartRequired,
    type: item.type,
  }))
}

/**
 * Returns the offending error string when `raw` is not a valid integer
 * within `[min, max]`. Returns undefined when the value is acceptable.
 * Used inline in the TUI input prompt so the validator's daemon round-
 * trip only fires for values that look numerically plausible.
 */
export function validateSettingInput(raw: string, descriptor: {max: number; min: number}): string | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return 'Value is required'

  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) return `Expected an integer, got '${raw}'`
  if (!Number.isInteger(numeric)) return `Expected an integer, got ${numeric}`
  if (numeric < descriptor.min || numeric > descriptor.max) {
    return `Value ${numeric} is outside allowed range [${descriptor.min}, ${descriptor.max}]`
  }

  return undefined
}
