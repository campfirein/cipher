import type {TaskType} from '../core/domain/transport/schemas.js'

/**
 * Type guard to check if value is a non-null object (Record).
 * Useful for safely narrowing unknown values before accessing properties.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard for valid task types.
 * Validates that a string is a supported TaskType ('curate' | 'query').
 *
 * @example
 * if (isValidTaskType(data.type)) {
 *   // data.type is narrowed to TaskType
 * }
 */
export function isValidTaskType(type: string): type is TaskType {
  return type === 'curate' || type === 'query'
}
