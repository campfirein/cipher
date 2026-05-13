import type {SettingsItemDTO} from '../../../../shared/transport/events/settings-events.js'

import {
  type DurationParseError,
  formatCount,
  formatDuration,
  parseDuration,
} from '../../../../shared/utils/format-duration.js'

export type SettingsRowCategory = 'concurrency' | 'llm' | 'other' | 'task-history'
export type SettingsRowUnit = 'count' | 'ms'

export interface SettingsRow {
  readonly category: SettingsRowCategory
  readonly current: number
  readonly default: number
  readonly description: string
  readonly displayCurrent: string
  readonly displayDefault: string
  readonly displayRange: string
  readonly key: string
  readonly label: string
  readonly max: number
  readonly min: number
  readonly modified: boolean
  readonly restartRequired: true
  readonly type: 'integer'
  readonly unit: SettingsRowUnit
}

const CATEGORY_ORDER: readonly SettingsRowCategory[] = ['concurrency', 'llm', 'task-history', 'other']

const CATEGORY_HEADERS: Readonly<Record<SettingsRowCategory, string>> = {
  concurrency: 'CONCURRENCY',
  llm: 'LLM',
  other: 'OTHER',
  'task-history': 'TASK HISTORY',
}

/**
 * Returns rows in `CONCURRENCY -> LLM -> TASK HISTORY -> OTHER` order with
 * display columns pre-formatted per the descriptor's unit field. Within each
 * group, items keep the order the daemon emitted (which today is the
 * registry order; group order is data-driven so a registry reshuffle does
 * not change the rendered output).
 */
export function buildSettingsRows(items: readonly SettingsItemDTO[]): SettingsRow[] {
  const rows = items.map((item) => toRow(item))
  return [...rows].sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
}

/**
 * Groups rows by category, preserving in-group order. Returns the ordered
 * list of `[header, rows]` pairs the TUI page renders as section blocks.
 */
export function groupRowsByCategory(rows: readonly SettingsRow[]): ReadonlyArray<{
  readonly category: SettingsRowCategory
  readonly header: string
  readonly rows: readonly SettingsRow[]
}> {
  const buckets = new Map<SettingsRowCategory, SettingsRow[]>()
  for (const row of rows) {
    const list = buckets.get(row.category) ?? []
    list.push(row)
    buckets.set(row.category, list)
  }

  const result: Array<{category: SettingsRowCategory; header: string; rows: readonly SettingsRow[]}> = []
  for (const category of CATEGORY_ORDER) {
    const bucket = buckets.get(category)
    if (bucket && bucket.length > 0) {
      result.push({category, header: CATEGORY_HEADERS[category], rows: bucket})
    }
  }

  return result
}

/**
 * Bottom-of-page hint line used by the page in each mode. Centralised here
 * so the page reads it as data rather than embedding mode-specific copy.
 */
export function bottomHintFor(mode: 'browse' | 'edit' | 'edit-error' | 'saving', focusedKey?: string): string {
  switch (mode) {
    case 'browse': {
      return 'Up/Down move | Enter edit | R reset | Esc exit'
    }

    case 'edit': {
      return `Editing ${focusedKey ?? ''} | Enter save | Esc cancel`
    }

    case 'edit-error': {
      return `Editing ${focusedKey ?? ''} | Enter save (when valid) | Esc cancel`
    }

    case 'saving': {
      return 'Saving... | Esc to exit (mutation resolves in background)'
    }
  }
}

/**
 * Buffer pre-fill value when the user enters edit mode on a row. Duration
 * keys show the human form (`10m`); count keys show the raw integer with
 * commas stripped so users can edit naturally.
 */
export function preFillBufferFor(row: SettingsRow): string {
  if (row.unit === 'ms') return formatDuration(row.current)
  return String(row.current)
}

export type RowParseResult =
  | {readonly displayValue: string; readonly kind: 'ok'; readonly value: number}
  | {readonly kind: 'error'; readonly message: string}

/**
 * Parses an edit-buffer input against a row's descriptor and returns either
 * the integer value to persist (`kind: 'ok'`) or a user-facing message
 * (`kind: 'error'`). Mirrors the oclif `set` dispatch so both surfaces
 * behave identically.
 */
export function parseRowInput(row: SettingsRow, raw: string): RowParseResult {
  const trimmed = raw.trim()
  if (trimmed === '') return {kind: 'error', message: 'Value is required'}

  if (row.unit === 'ms') return parseAsDuration(row, raw)
  return parseAsCount(row, raw)
}

function parseAsDuration(row: SettingsRow, raw: string): RowParseResult {
  const parsed = parseDuration(raw)
  if (typeof parsed === 'number') {
    if (parsed < row.min || parsed > row.max) {
      return {
        kind: 'error',
        message: `value ${formatDuration(parsed)} is outside allowed range [${formatDuration(row.min)}, ${formatDuration(row.max)}]`,
      }
    }

    return {displayValue: formatDuration(parsed), kind: 'ok', value: parsed}
  }

  return {kind: 'error', message: describeDurationError(parsed)}
}

function parseAsCount(row: SettingsRow, raw: string): RowParseResult {
  if (/\d+\s*(?:ms|s|m|h)/i.test(raw)) {
    return {kind: 'error', message: `${row.key} expects an integer count, got duration '${raw}'.`}
  }

  const stripped = raw.replaceAll(',', '').trim()
  if (!/^-?\d+$/.test(stripped)) {
    return {kind: 'error', message: `Expected an integer, got '${raw}'`}
  }

  const numeric = Number.parseInt(stripped, 10)
  if (!Number.isFinite(numeric)) return {kind: 'error', message: `Expected an integer, got '${raw}'`}
  if (numeric < row.min || numeric > row.max) {
    return {kind: 'error', message: `out of range: max ${row.max}`}
  }

  return {displayValue: formatCount(numeric), kind: 'ok', value: numeric}
}

function describeDurationError(error: DurationParseError): string {
  return error.hint
}

/**
 * Legacy helper kept for back-compat with the M4 T1 edit prompt. Internally
 * delegates to `parseRowInput` against a synthetic count-unit descriptor so
 * existing callers (count-only) keep their integer-validation behaviour.
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

function toRow(item: SettingsItemDTO): SettingsRow {
  const unit: SettingsRowUnit = item.unit ?? 'count'
  const category: SettingsRowCategory = item.category ?? 'other'
  const displayCurrent = unit === 'ms' ? formatDuration(item.current) : formatCount(item.current)
  const displayDefault = unit === 'ms' ? formatDuration(item.default) : formatCount(item.default)
  const displayRange = formatRange(item, unit)

  return {
    category,
    current: item.current,
    default: item.default,
    description: item.description,
    displayCurrent,
    displayDefault,
    displayRange,
    key: item.key,
    label: item.key,
    max: item.max,
    min: item.min,
    modified: item.current !== item.default,
    restartRequired: item.restartRequired,
    type: item.type,
    unit,
  }
}

function formatRange(item: SettingsItemDTO, unit: SettingsRowUnit): string {
  const min = unit === 'ms' ? formatDuration(item.min) : formatCount(item.min)
  const max = unit === 'ms' ? formatDuration(item.max) : formatCount(item.max)
  const base = `${min}-${max}`
  if (item.key === 'llm.requestTimeoutMs') return `${base}, max loop budget`
  return base
}
