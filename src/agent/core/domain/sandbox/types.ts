/**
 * Sandbox types for code execution in isolated environment.
 * Following design patterns from rlm/rlm/environments/local_repl.py
 */

/**
 * Result of code execution in the sandbox.
 */
export interface REPLResult {
  /** Accumulated curate() call results from within sandbox execution */
  curateResults?: unknown[]

  /** Execution time in milliseconds */
  executionTime: number

  /** If set by setFinalResult(), signals early termination of the agentic loop */
  finalResult?: string

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
  /** Command type for gating SDK operations (e.g., 'query' disables curate/writeFile) */
  commandType?: string

  /** Context data to preload as "context" variable */
  contextPayload?: Record<string, unknown> | string | unknown[]

  /**
   * Conversation turn index (zero-based, user-messages only) — the Nth
   * user message in the session when this code_exec fired. Used by
   * refinement to cluster outcomes by task stage.
   */
  conversationTurn?: number

  /** Language: 'javascript' or 'typescript' (default: auto-detect) */
  language?: 'javascript' | 'typescript'

  /** Cap stdout buffer at this many characters. undefined = unlimited. */
  maxStdoutChars?: number

  /**
   * Free-text description of the task the user requested when this
   * code_exec fired. Truncated to 500 chars at the call site. Used by
   * refinement as the primary signal for matching outcomes to evaluation
   * scenarios.
   */
  taskDescription?: string

  /** Timeout in ms (default: 30000, max: 300000) */
  timeout?: number
}
