/**
 * Safely extracts an error message from an unknown error value.
 *
 * This utility handles various error types that can be thrown in JavaScript:
 * - Error instances (standard Error, custom Error subclasses)
 * - Objects with message property
 * - Strings
 * - Other primitive types
 *
 * @param error - The caught error value (unknown type)
 * @returns A string message describing the error
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation()
 * } catch (error) {
 *   throw new Error(`Operation failed: ${getErrorMessage(error)}`)
 * }
 * ```
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const {message} = error as {message: unknown}
    if (typeof message === 'string') {
      return message
    }
  }

  // Fallback: JSON for objects (avoids "[object Object]"), String for primitives
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }

  return String(error)
}

/**
 * Type guard to check if a value is an Error instance.
 * Useful for conditional error handling logic.
 *
 * @param error - The value to check
 * @returns True if the value is an Error instance
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error
}
