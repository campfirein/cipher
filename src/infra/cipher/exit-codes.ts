/**
 * Exit codes for cipher-agent command
 *
 * These codes follow Unix conventions and provide clear signals
 * for scripting and automation scenarios.
 */
export const ExitCode = {
  /**
   * Configuration error - Invalid API key, missing model config, invalid settings
   */
  CONFIG_ERROR: 3,

  /**
   * Runtime error - LLM execution failure, network issues, unexpected errors
   */
  RUNTIME_ERROR: 1,

  /**
   * Success - AI response generated successfully
   */
  SUCCESS: 0,

  /**
   * Validation error - Invalid input, workspace not initialized, file not found
   */
  VALIDATION_ERROR: 2,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]

/**
 * Exit the process with the given code and optional error message
 *
 * @param code - Exit code to use
 * @param message - Optional error message to write to stderr
 * @throws {Error} Always throws with the code attached for oclif to handle
 */
export function exitWithCode(code: ExitCode, message?: string): never {
  if (message) {
    process.stderr.write(`${message}\n`)
  }

  // Create an error with exit code for oclif
  const error = new Error(message ?? 'Exit')
  ;(error as Error & {code: number; oclif: {exit: number}}).code = code
  ;(error as Error & {code: number; oclif: {exit: number}}).oclif = {exit: code}
  throw error
}
