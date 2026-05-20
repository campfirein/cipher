import {format, startOfDay, startOfMonth, startOfWeek} from 'date-fns'

export type TimePreset = 'all' | 'month' | 'today' | 'week'

export const TIME_PRESETS: ReadonlyArray<{label: string; value: TimePreset}> = [
  {label: 'Any time', value: 'all'},
  {label: 'Today', value: 'today'},
  {label: 'This week', value: 'week'},
  {label: 'This month', value: 'month'},
]

const DAY_MS = 24 * 60 * 60 * 1000

export function timePresetToRange(preset: TimePreset, now: number): {createdAfter?: number; createdBefore?: number} {
  if (preset === 'all') return {}
  if (preset === 'today') return {createdAfter: startOfDay(now).getTime()}
  if (preset === 'week') return {createdAfter: startOfWeek(now, {weekStartsOn: 1}).getTime()}
  if (preset === 'month') return {createdAfter: startOfMonth(now).getTime()}
  return {}
}

export function timePresetLabel(preset: TimePreset): string {
  return TIME_PRESETS.find((p) => p.value === preset)?.label ?? 'Any time'
}

export function detectActiveTimePreset(
  range: {createdAfter?: number; createdBefore?: number},
  now: number,
): 'custom' | TimePreset {
  if (range.createdAfter === undefined && range.createdBefore === undefined) return 'all'
  for (const preset of TIME_PRESETS) {
    if (preset.value === 'all') continue
    const expected = timePresetToRange(preset.value, now)
    if (expected.createdAfter === range.createdAfter && expected.createdBefore === range.createdBefore) {
      return preset.value
    }
  }

  return 'custom'
}

function formatRangeBoundary(ms: number): string {
  return format(ms, 'd MMM yyyy')
}

export function formatTimeRangeLabel(range: {createdAfter?: number; createdBefore?: number}): string {
  if (range.createdAfter !== undefined && range.createdBefore !== undefined) {
    return `${formatRangeBoundary(range.createdAfter)} – ${formatRangeBoundary(range.createdBefore)}`
  }

  if (range.createdAfter !== undefined) return `Since ${formatRangeBoundary(range.createdAfter)}`
  if (range.createdBefore !== undefined) return `Until ${formatRangeBoundary(range.createdBefore)}`
  return 'Any time'
}

export {DAY_MS}
