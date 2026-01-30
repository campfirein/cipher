import {type TaskType, TaskTypeSchema} from '@campfirein/brv-transport-client'

/**
 * Type guard to check if value is a non-null object (Record).
 * Useful for safely narrowing unknown values before accessing properties.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Type guard for valid task types.
 * Uses TaskTypeSchema as the single source of truth.
 *
 * @example
 * if (isValidTaskType(data.type)) {
 *   // data.type is narrowed to TaskType
 * }
 */
export function isValidTaskType(value: string): value is TaskType {
  return TaskTypeSchema.safeParse(value).success
}
