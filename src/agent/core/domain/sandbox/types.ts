/**
 * Sandbox types for code execution in isolated environment.
 * Following design patterns from rlm/rlm/environments/local_repl.py
 */

/**
 * Result of code execution in the sandbox.
 */
export interface REPLResult {
  /** Execution time in milliseconds */
  executionTime: number

  /** Current context state (variable names to values) */
  locals: Record<string, unknown>

  /** Return value of the last expression (if any) */
  returnValue?: unknown

  /** Error output (console.error, console.warn, exceptions) */
  stderr: string

  /** Console output (console.log, console.info) */
  stdout: string
}

/**
 * Configuration for sandbox execution.
 */
export interface SandboxConfig {
  /** Context data to preload as "context" variable */
  contextPayload?: Record<string, unknown> | string | unknown[]

  /** Language: 'javascript' or 'typescript' (default: auto-detect) */
  language?: 'javascript' | 'typescript'

  /** Timeout in ms (default: 30000, max: 300000) */
  timeout?: number
}
