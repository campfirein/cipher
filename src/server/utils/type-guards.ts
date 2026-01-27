/**
 * Type guard to check if value is a non-null object (Record).
 * Useful for safely narrowing unknown values before accessing properties.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
