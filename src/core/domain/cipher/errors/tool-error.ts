/**
 * Base error class for tool operations.
 * All tool-specific errors extend this base class.
 */
export class ToolError extends Error {
  public readonly code: string
  public readonly details?: Record<string, unknown>

  /**
   * Creates a new tool error
   * @param message - Error message describing what went wrong
   * @param code - Error code for categorization
   * @param details - Additional error context
   */
  public constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ToolError'
    this.code = code
    this.details = details
  }
}

/**
 * Error thrown when a tool is not found.
 */
export class ToolNotFoundError extends ToolError {
  /**
   * Creates a new tool not found error
   * @param toolName - Name of the tool that was not found
   */
  public constructor(toolName: string) {
    super(`Tool not found: ${toolName}`, 'TOOL_NOT_FOUND', {toolName})
    this.name = 'ToolNotFoundError'
  }
}

/**
 * Error thrown when tool execution fails.
 */
export class ToolExecutionError extends ToolError {
  /**
   * Creates a new tool execution error
   * @param toolName - Name of the tool that failed
   * @param reason - Reason for the failure
   * @param sessionId - Optional session ID
   */
  public constructor(toolName: string, reason: string, sessionId?: string) {
    super(`Tool execution failed: ${toolName}. Reason: ${reason}`, 'TOOL_EXECUTION_FAILED', {
      reason,
      sessionId,
      toolName,
    })
    this.name = 'ToolExecutionError'
  }
}

/**
 * Error thrown when tool input validation fails.
 */
export class ToolValidationError extends ToolError {
  /**
   * Creates a new tool validation error
   * @param toolName - Name of the tool
   * @param validationErrors - Validation error details
   */
  public constructor(toolName: string, validationErrors: string) {
    super(`Tool input validation failed: ${toolName}. ${validationErrors}`, 'TOOL_VALIDATION_FAILED', {
      toolName,
      validationErrors,
    })
    this.name = 'ToolValidationError'
  }
}

/**
 * Error thrown when the tool provider is not initialized.
 */
export class ToolProviderNotInitializedError extends ToolError {
  /**
   * Creates a new tool provider not initialized error
   */
  public constructor() {
    super('ToolProvider not initialized. Call initialize() before using tools', 'TOOL_PROVIDER_NOT_INITIALIZED')
    this.name = 'ToolProviderNotInitializedError'
  }
}