/**
 * Helper utilities for handling oclif-specific errors
 *
 * These utilities help avoid duplicating error handling logic across commands
 */

/**
 * Handle oclif error exit codes
 *
 * If the error has an oclif.exit property (set by this.error()), exit the process
 * with that code. This prevents oclif from re-logging errors that were already displayed.
 *
 * @param error - Error with optional oclif metadata
 * @returns true if error was handled (process exited), false if error should be re-thrown
 *
 * @example
 * public async catch(error: Error & {oclif?: {exit: number}}): Promise<void> {
 *   if (handleOclifExit(error)) return
 *   // Handle other error cases...
 * }
 */
export function handleOclifExit(error: Error & {oclif?: {exit: number}}): boolean {
  if (error.oclif?.exit !== undefined) {
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(error.oclif.exit)
  }

  return false
}

/**
 * Check if error is an oclif validation error
 *
 * Validation errors include missing arguments, unexpected arguments, and missing flags.
 * These should be re-thrown to let oclif's error handler display them properly.
 *
 * @param error - Error to check
 * @returns true if error is a validation error
 *
 * @example
 * if (isValidationError(error)) {
 *   throw error // Let oclif handle it
 * }
 */
export function isValidationError(error: Error): boolean {
  return (
    error.message.includes('Unexpected argument') ||
    error.message.includes('Missing') ||
    error.message.includes('required')
  )
}
