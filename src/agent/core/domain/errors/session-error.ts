/**
 * Base error class for session operations.
 * All session-specific errors extend this base class.
 */
export class SessionError extends Error {
  public readonly code: string
  public readonly details?: Record<string, unknown>

  /**
   * Creates a new session error
   * @param message - Error message describing what went wrong
   * @param code - Error code for categorization
   * @param details - Additional error context
   */
  public constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'SessionError'
    this.code = code
    this.details = details
  }
}

/**
 * Error thrown when tool execution loop exceeds maximum iterations.
 */
export class MaxIterationsExceededError extends SessionError {
  /**
   * Creates a new max iterations exceeded error
   * @param maxIterations - Maximum iterations allowed
   * @param sessionId - Session ID where error occurred
   */
  public constructor(maxIterations: number, sessionId: string) {
    super(
      `Tool execution loop exceeded maximum iterations (${maxIterations}). This may indicate an infinite loop.`,
      'MAX_ITERATIONS_EXCEEDED',
      {maxIterations, sessionId},
    )
    this.name = 'MaxIterationsExceededError'
  }
}

/**
 * Error thrown when a session operation is cancelled.
 */
export class SessionCancelledError extends SessionError {
  /**
   * Creates a new session cancelled error
   * @param sessionId - Session ID where cancellation occurred
   */
  public constructor(sessionId: string) {
    super('Session operation was cancelled by user', 'SESSION_CANCELLED', {sessionId})
    this.name = 'SessionCancelledError'
  }
}

/**
 * Error thrown when LLM service call fails.
 */
export class LLMError extends SessionError {
  /**
   * Creates a new LLM error
   * @param reason - Reason for the failure (already formatted, user-friendly message)
   * @param sessionId - Session ID where error occurred
   */
  public constructor(reason: string, sessionId: string) {
    // Pass reason as-is since it's already formatted with user-friendly message
    super(reason, 'LLM_ERROR', {reason, sessionId})
    this.name = 'LLMError'
  }
}

/**
 * Error thrown when session is not initialized.
 */
export class SessionNotInitializedError extends SessionError {
  /**
   * Creates a new session not initialized error
   */
  public constructor() {
    super('Session not initialized. Cannot perform operations.', 'SESSION_NOT_INITIALIZED')
    this.name = 'SessionNotInitializedError'
  }
}
