/**
 * Base error class for LLM-related operations.
 * All LLM-specific errors extend this base class.
 */
export class LlmError extends Error {
  public readonly code?: string
  public readonly details?: Record<string, unknown>
  public readonly model?: string
  public readonly provider?: string

  /**
   * Creates a new LLM error
   * @param message - Error message describing what went wrong
   * @param code - Error code for categorization (e.g., 'LLM_GENERATION_FAILED')
   * @param provider - LLM provider name (e.g., 'gemini', 'openai')
   * @param model - Model name that was being used (e.g., 'gemini-2.5-flash')
   */
  public constructor(message: string, code?: string, provider?: string, model?: string) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.provider = provider
    this.model = model
  }
}

/**
 * Error thrown when LLM generation fails.
 * This can happen due to API errors, network issues, or model failures.
 */
export class LlmGenerationError extends LlmError {
  public readonly originalError: string

  /**
   * Creates a new generation error
   * @param error - The original error message from the LLM provider
   * @param provider - LLM provider name
   * @param model - Model name that was being used
   */
  public constructor(error: string, provider: string, model: string) {
    // Don't add "Generation failed:" prefix if error already has emoji prefix (user-friendly message)
    const message = error.startsWith('❌') ? error : `Generation failed: ${error}`
    super(message, 'LLM_GENERATION_FAILED', provider, model)
    this.name = 'LlmGenerationError'
    this.originalError = error
  }
}

/**
 * Error thrown when rate limits are exceeded.
 * Includes optional retry delay information.
 */
export class LlmRateLimitError extends LlmError {
  public readonly retryAfter?: number

  /**
   * Creates a new rate limit error
   * @param provider - LLM provider name
   * @param retryAfter - Optional number of seconds to wait before retrying
   */
  public constructor(provider: string, retryAfter?: number) {
    const message = retryAfter
      ? `Rate limit exceeded for ${provider}. Retry after ${retryAfter} seconds`
      : `Rate limit exceeded for ${provider}. Please wait before retrying`

    super(message, 'LLM_RATE_LIMIT_EXCEEDED', provider)
    this.name = 'LlmRateLimitError'
    this.retryAfter = retryAfter
  }

  /**
   * Gets the retry delay in milliseconds
   * @returns Delay in milliseconds, or undefined if not specified
   */
  public getRetryAfterMs(): number | undefined {
    return this.retryAfter ? this.retryAfter * 1000 : undefined
  }
}

/**
 * Error thrown when maximum iterations are exceeded in agentic loops.
 * This prevents infinite loops when tool calling doesn't converge.
 */
export class LlmMaxIterationsError extends LlmError {
  public readonly maxIterations: number

  /**
   * Creates a new max iterations error
   * @param maxIterations - The maximum number of iterations that was configured
   * @param provider - LLM provider name
   * @param model - Model name that was being used
   */
  public constructor(maxIterations: number, provider: string, model: string) {
    super(
      `Maximum iterations (${maxIterations}) reached without completion`,
      'LLM_MAX_ITERATIONS_EXCEEDED',
      provider,
      model,
    )
    this.name = 'LlmMaxIterationsError'
    this.maxIterations = maxIterations
  }
}

/**
 * Error thrown when tool execution fails during LLM operations.
 * This occurs when the LLM requests a tool call but the execution fails.
 */
export class LlmToolExecutionError extends LlmError {
  public readonly originalError: string
  public readonly toolName: string

  /**
   * Creates a new tool execution error
   * @param toolName - Name of the tool that failed
   * @param error - The original error message
   * @param provider - LLM provider name
   * @param model - Model name that was being used
   */
  public constructor(toolName: string, error: string, provider: string, model: string) {
    super(
      `Tool execution failed for '${toolName}': ${error}`,
      'LLM_TOOL_EXECUTION_FAILED',
      provider,
      model,
    )
    this.name = 'LlmToolExecutionError'
    this.toolName = toolName
    this.originalError = error
  }
}

/**
 * Error thrown when LLM configuration is invalid or missing.
 * This includes missing API keys, invalid settings, etc.
 */
export class LlmConfigurationError extends LlmError {
  public readonly configKey: string

  /**
   * Creates a new configuration error
   * @param configKey - The configuration key that is problematic
   * @param message - Description of the configuration issue
   * @param provider - LLM provider name
   */
  public constructor(configKey: string, message: string, provider: string) {
    super(`Configuration error for '${configKey}': ${message}`, 'LLM_CONFIGURATION_ERROR', provider)
    this.name = 'LlmConfigurationError'
    this.configKey = configKey
  }
}

/**
 * Error thrown when parsing LLM responses fails.
 * This occurs when the response format is unexpected or malformed.
 */
export class LlmResponseParsingError extends LlmError {
  public readonly originalError: string

  /**
   * Creates a new response parsing error
   * @param error - Description of the parsing error
   * @param provider - LLM provider name
   * @param model - Model name that was being used
   */
  public constructor(error: string, provider: string, model: string) {
    super(`Response parsing failed: ${error}`, 'LLM_RESPONSE_PARSING_FAILED', provider, model)
    this.name = 'LlmResponseParsingError'
    this.originalError = error
  }
}

/**
 * Error thrown when no tool executor is provided but tools are requested.
 * This is a configuration issue where the LLM wants to call tools but can't.
 */
export class LlmMissingToolExecutorError extends LlmError {
  /**
   * Creates a new missing tool executor error
   * @param provider - LLM provider name
   * @param model - Model name that was being used
   */
  public constructor(provider: string, model: string) {
    super(
      'Function calls requested but no tool executor provided',
      'LLM_TOOL_EXECUTOR_MISSING',
      provider,
      model,
    )
    this.name = 'LlmMissingToolExecutorError'
  }
}