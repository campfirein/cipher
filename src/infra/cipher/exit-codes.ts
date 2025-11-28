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
} as const

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]

/**
 * Custom error class for exit codes with oclif integration.
 * Extends Error to add code and oclif properties without type assertions.
 */
export class ExitError extends Error {
  public readonly code: number
  public readonly oclif: {exit: number}

  constructor(code: ExitCode, message?: string) {
    super(message ?? 'Exit')
    this.name = 'ExitError'
    this.code = code
    this.oclif = {exit: code}
  }
}

/**
 * Exit the process with the given code and optional error message
 *
 * @param code - Exit code to use
 * @param message - Optional error message to write to stderr
 * @throws {ExitError} Throws ExitError for oclif to handle (except for silent success exits)
 */
export function exitWithCode(code: ExitCode, message?: string): never {
  if (message) {
    process.stderr.write(`${message}\n`)
  }

  // For successful exits without message, exit silently via process.exit
  // This prevents oclif from showing "Error: Exit" or similar messages
  if (code === ExitCode.SUCCESS && !message) {
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(code)
  }

  // Throw ExitError - no type assertions needed!
  throw new ExitError(code, message)
}
