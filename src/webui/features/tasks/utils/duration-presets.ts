export type DurationPreset = 'all' | 'long' | 'medium' | 'short' | 'very-long'

export const DURATION_PRESETS: ReadonlyArray<{label: string; value: DurationPreset}> = [
  {label: 'Any duration', value: 'all'},
  {label: '< 5s', value: 'short'},
  {label: '5s – 30s', value: 'medium'},
  {label: '30s – 2m', value: 'long'},
  {label: '> 2m', value: 'very-long'},
]

const DURATION_VALUES = new Set<string>(DURATION_PRESETS.map((p) => p.value))

export function isDurationPreset(value: string): value is DurationPreset {
  return DURATION_VALUES.has(value)
}

const DURATION_LABEL: Record<DurationPreset, string> = {
  all: 'Any duration',
  long: '30s – 2m',
  medium: '5s – 30s',
  short: '< 5s',
  'very-long': '> 2m',
}

const DURATION_RANGE: Record<DurationPreset, {maxDurationMs?: number; minDurationMs?: number}> = {
  all: {},
  long: {maxDurationMs: 120_000, minDurationMs: 30_000},
  medium: {maxDurationMs: 30_000, minDurationMs: 5000},
  short: {maxDurationMs: 5000},
  'very-long': {minDurationMs: 120_000},
}

export function durationPresetToRange(preset: DurationPreset): {maxDurationMs?: number; minDurationMs?: number} {
  return DURATION_RANGE[preset]
}

export function durationPresetLabel(preset: DurationPreset): string {
  return DURATION_LABEL[preset]
}
