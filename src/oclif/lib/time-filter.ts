const RELATIVE_TIME_PATTERN = /^(\d+)(m|h|d|w)$/

/**
 * Parse a time filter value into a UTC millisecond timestamp.
 *
 * Accepts:
 *  - Relative: "30m", "1h", "24h", "7d", "2w"
 *  - Absolute: ISO date "2024-01-15" or datetime "2024-01-15T12:00:00Z"
 *
 * Returns null when the value cannot be parsed.
 */
export function parseTimeFilter(value: string): null | number {
  const relMatch = RELATIVE_TIME_PATTERN.exec(value)
  if (relMatch) {
    const amount = Number(relMatch[1])
    const unit = relMatch[2]
    const multipliers: Record<string, number> = {d: 86_400_000, h: 3_600_000, m: 60_000, w: 604_800_000}
    return Date.now() - amount * multipliers[unit]
  }

  const ts = new Date(value).getTime()
  return Number.isNaN(ts) ? null : ts
}
