/**
 * Tool Error Types and Classes
 *
 * Provides structured error classification for tool execution failures.
 * Enables better error handling, debugging, and LLM guidance.
 */

/**
 * Enum of all possible tool error types.
 * Each type represents a specific failure category.
 */
export enum ToolErrorType {
  // Discovery errors - tool not found or unavailable
  CANCELLED = 'CANCELLED',
  CONFIRMATION_REJECTED = 'CONFIRMATION_REJECTED',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  INVALID_PARAM_TYPE = 'INVALID_PARAM_TYPE',
  INVALID_PARAMS = 'INVALID_PARAMS',
  MISSING_REQUIRED_PARAM = 'MISSING_REQUIRED_PARAM',
  PARAM_VALIDATION_FAILED = 'PARAM_VALIDATION_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  TIMEOUT = 'TIMEOUT',
  TOOL_DISABLED = 'TOOL_DISABLED',
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
}

/**
 * Structured result from tool execution.
 * Provides consistent format for both success and error cases.
 */
export interface ToolExecutionResult {
  /**
   * Tool output content (string representation)
   * For errors, contains error message formatted for LLM
   */
  content: string

  /**
   * Detailed error message (only present on failure)
   */
  errorMessage?: string

  /**
   * Error type classification (only present on failure)
   */
  errorType?: ToolErrorType

  /**
   * Additional metadata about the execution
   */
  metadata?: {
    /**
     * Any other custom metadata
     */
    [key: string]: unknown

    /**
     * Execution duration in milliseconds
     */
    durationMs?: number

    /**
     * Original content length before truncation
     */
    originalLength?: number

    /**
     * Path to file if output was saved
     */
    savedToFile?: string

    /**
     * Token count for the result (if available)
     */
    tokensUsed?: number

    /**
     * Whether output was truncated
     */
    truncated?: boolean
  }

  /**
   * Whether the tool executed successfully
   */
  success: boolean
}

/**
 * Options for creating a ToolError
 */
export interface ToolErrorOptions {
  /**
   * Additional context about the error
   */
  context?: Record<string, unknown>

  /**
   * Original error that caused the failure
   */
  originalError?: Error
}

/**
 * Structured error class for tool failures.
 * Wraps error information with type classification.
 */
export class ToolError extends Error {
  /**
   * Additional context about the error
   */
  public readonly context?: Record<string, unknown>
  /**
   * Original error that caused the failure (if any)
   */
  public readonly originalError?: Error
  /**
   * Name of the tool that failed
   */
  public readonly toolName: string
  /**
   * Classified error type
   */
  public readonly type: ToolErrorType

  /**
   * Create a new ToolError
   *
   * @param message - Human-readable error message
   * @param type - Classified error type
   * @param toolName - Name of the tool that failed
   * @param options - Optional error context and original error
   */
  constructor(
    message: string,
    type: ToolErrorType,
    toolName: string,
    options?: ToolErrorOptions
  ) {
    super(message)
    this.name = 'ToolError'
    this.type = type
    this.toolName = toolName
    this.originalError = options?.originalError
    this.context = options?.context

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ToolError)
    }
  }

  /**
   * Convert error to JSON for serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      context: this.context,
      message: this.message,
      name: this.name,
      originalError: this.originalError?.message,
      toolName: this.toolName,
      type: this.type,
    }
  }

  /**
   * Format error message for LLM consumption
   * Provides clear, actionable error information
   */
  toLLMMessage(): string {
    const parts: string[] = [
      `Tool execution failed: ${this.toolName}`,
      `Error type: ${this.type}`,
      `Message: ${this.message}`,
    ]

    if (this.context && Object.keys(this.context).length > 0) {
      parts.push(`Context: ${JSON.stringify(this.context)}`)
    }

    return parts.join('\n')
  }
}

/**
 * Utility functions for error classification and handling
 */
export class ToolErrorUtils {
  /**
   * Classify an unknown error into a ToolError
   *
   * @param error - Error to classify
   * @param toolName - Name of the tool
   * @returns Classified ToolError
   */
  static classify(error: unknown, toolName: string): ToolError {
    // Already a ToolError - return as-is
    if (error instanceof ToolError) {
      return error
    }

    // Convert to ToolError with classification
    if (error instanceof Error) {
      const message = error.message.toLowerCase()

      // Classify based on error message patterns
      if (message.includes('not found') || message.includes('does not exist')) {
        return new ToolError(error.message, ToolErrorType.TOOL_NOT_FOUND, toolName, {originalError: error})
      }

      if (message.includes('timeout') || message.includes('timed out')) {
        return new ToolError(error.message, ToolErrorType.TIMEOUT, toolName, {originalError: error})
      }

      if (message.includes('permission') || message.includes('unauthorized') || message.includes('forbidden')) {
        return new ToolError(error.message, ToolErrorType.PERMISSION_DENIED, toolName, {originalError: error})
      }

      if (message.includes('cancelled') || message.includes('abort')) {
        return new ToolError(error.message, ToolErrorType.CANCELLED, toolName, {originalError: error})
      }

      if (message.includes('invalid') || message.includes('validation')) {
        return new ToolError(error.message, ToolErrorType.INVALID_PARAMS, toolName, {originalError: error})
      }

      if (message.includes('required') || message.includes('missing')) {
        return new ToolError(error.message, ToolErrorType.MISSING_REQUIRED_PARAM, toolName, {originalError: error})
      }

      // Default to execution failed
      return new ToolError(error.message, ToolErrorType.EXECUTION_FAILED, toolName, {originalError: error})
    }

    // Non-Error object - wrap as internal error
    return new ToolError(
      String(error),
      ToolErrorType.INTERNAL_ERROR,
      toolName,
      {context: {originalValue: error}}
    )
  }

  /**
   * Create an error result from a ToolError
   *
   * @param toolError - Tool error to convert
   * @param metadata - Optional metadata
   * @returns Error result
   */
  static createErrorResult(toolError: ToolError, metadata?: ToolExecutionResult['metadata']): ToolExecutionResult {
    return {
      content: toolError.toLLMMessage(),
      errorMessage: toolError.message,
      errorType: toolError.type,
      metadata: {
        ...metadata,
        context: toolError.context,
        originalError: toolError.originalError?.message,
      },
      success: false,
    }
  }

  /**
   * Create a success result
   *
   * @param content - Tool output content
   * @param metadata - Optional metadata
   * @returns Success result
   */
  static createSuccess(content: unknown, metadata?: ToolExecutionResult['metadata']): ToolExecutionResult {
    return {
      content: String(content),
      metadata,
      success: true,
    }
  }

  /**
   * Format error for LLM with specific guidance based on error type
   *
   * @param toolError - Tool error to format
   * @returns Formatted error message for LLM
   */
  static formatForLLM(toolError: ToolError): string {
    const baseMessage = toolError.toLLMMessage()

    // Add specific guidance based on error type
    const guidance = this.getGuidanceForErrorType(toolError.type)
    if (guidance) {
      return `${baseMessage}\n\nGuidance: ${guidance}`
    }

    return baseMessage
  }

  /**
   * Check if an error is retryable
   *
   * @param toolError - Tool error to check
   * @returns True if the error might succeed on retry
   */
  static isRetryable(toolError: ToolError): boolean {
    // Some error types should not be retried
    const nonRetryableTypes = new Set([
      ToolErrorType.CANCELLED,
      ToolErrorType.CONFIRMATION_REJECTED,
      ToolErrorType.EXECUTION_FAILED,
      ToolErrorType.INVALID_PARAM_TYPE,
      ToolErrorType.INVALID_PARAMS,
      ToolErrorType.MISSING_REQUIRED_PARAM,
      ToolErrorType.PARAM_VALIDATION_FAILED,
      ToolErrorType.PERMISSION_DENIED,
      ToolErrorType.TOOL_DISABLED,
      ToolErrorType.TOOL_NOT_FOUND,
    ])

    return !nonRetryableTypes.has(toolError.type)
  }

  /**
   * Get actionable guidance for an error type
   *
   * @param errorType - Type of error
   * @returns Guidance message or null
   */
  private static getGuidanceForErrorType(errorType: ToolErrorType): null | string {
    switch (errorType) {
      case ToolErrorType.EXECUTION_FAILED: {
        return 'The tool encountered an error during execution. Review the error message and adjust your approach.'
      }

      case ToolErrorType.INVALID_PARAM_TYPE:
      case ToolErrorType.INVALID_PARAMS:
      case ToolErrorType.MISSING_REQUIRED_PARAM: {
        return 'Check the tool schema and ensure all required parameters are provided with correct types.'
      }

      case ToolErrorType.PERMISSION_DENIED: {
        return 'You do not have permission to execute this tool. Consider asking the user for permission.'
      }

      case ToolErrorType.TIMEOUT: {
        return 'The tool execution timed out. Try breaking the task into smaller steps or use a different approach.'
      }

      case ToolErrorType.TOOL_NOT_FOUND: {
        return 'The tool you requested does not exist. Use list_tools to see available tools.'
      }

      default: {
        return null
      }
    }
  }
}
