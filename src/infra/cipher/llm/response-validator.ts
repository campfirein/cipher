/**
 * Response Validation Layer
 *
 * Validates LLM responses before processing to catch malformed content.
 * Implements retry logic with exponential backoff for validation failures.
 */

import type {InternalMessage} from '../../../core/interfaces/cipher/message-types.js'

/**
 * Types of validation errors that can occur
 */
export type ResponseValidationType =
  | 'EMPTY_RESPONSE'
  | 'INVALID_ROLE'
  | 'MALFORMED_TOOL_CALL'
  | 'NO_CONTENT'
  | 'NO_MESSAGES'

/**
 * Error thrown when response validation fails
 */
export class ResponseValidationError extends Error {
  /**
   * Original response that failed validation (for debugging)
   */
  public readonly originalResponse?: unknown
  /**
   * Type of validation failure
   */
  public readonly validationType: ResponseValidationType

  /**
   * Create a new ResponseValidationError
   *
   * @param message - Human-readable error message
   * @param validationType - Type of validation failure
   * @param originalResponse - Original response object (optional)
   */
  constructor(message: string, validationType: ResponseValidationType, originalResponse?: unknown) {
    super(message)
    this.name = 'ResponseValidationError'
    this.validationType = validationType
    this.originalResponse = originalResponse

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ResponseValidationError)
    }
  }

  /**
   * Convert error to JSON for serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      message: this.message,
      name: this.name,
      validationType: this.validationType,
    }
  }
}

/**
 * Response validator with validation rules and helper methods
 */
export const ResponseValidator = {
  /**
   * Validate individual message structure
   *
   * Checks that message has:
   * 1. Valid role (assistant)
   * 2. Either content or tool calls
   * 3. Well-formed tool calls (if present)
   *
   * @param message - Internal message to validate
   * @throws ResponseValidationError if validation fails
   */
  validateMessage(message: InternalMessage): void {
    // Validate role
    if (!message.role) {
      throw new ResponseValidationError('Message missing role', 'INVALID_ROLE', message)
    }

    if (message.role !== 'assistant') {
      throw new ResponseValidationError(
        `Invalid role for LLM response: ${message.role} (expected 'assistant')`,
        'INVALID_ROLE',
        message
      )
    }

    // Validate has content or tool calls
    const hasContent = message.content && (
      (typeof message.content === 'string' && message.content.length > 0) ||
      (Array.isArray(message.content) && message.content.length > 0)
    )
    const hasToolCalls = message.toolCalls && message.toolCalls.length > 0

    if (!hasContent && !hasToolCalls) {
      throw new ResponseValidationError(
        'Message has neither content nor tool calls',
        'NO_CONTENT',
        message
      )
    }

    // Validate tool calls if present
    if (hasToolCalls && message.toolCalls) {
      for (const toolCall of message.toolCalls) {
        if (!toolCall.id) {
          throw new ResponseValidationError(
            'Tool call missing id',
            'MALFORMED_TOOL_CALL',
            toolCall
          )
        }

        if (!toolCall.function?.name) {
          throw new ResponseValidationError(
            'Tool call missing function name',
            'MALFORMED_TOOL_CALL',
            toolCall
          )
        }

        // Validate arguments is valid JSON string
        if (toolCall.function.arguments) {
          try {
            JSON.parse(toolCall.function.arguments)
          } catch {
            throw new ResponseValidationError(
              `Tool call has invalid JSON arguments: ${toolCall.function.arguments}`,
              'MALFORMED_TOOL_CALL',
              toolCall
            )
          }
        }
      }
    }
  },

  /**
   * Validate parsed message array
   *
   * Checks that:
   * 1. Array is not empty
   * 2. Has at least one message
   *
   * @param messages - Parsed messages from formatter
   * @throws ResponseValidationError if validation fails
   */
  validateMessageArray(messages: InternalMessage[]): void {
    // Check has messages
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new ResponseValidationError('Response contains no messages', 'NO_MESSAGES', messages)
    }
  },

  /**
   * Validate raw response from LLM provider
   *
   * Checks that response is:
   * 1. Not null/undefined
   * 2. An object
   *
   * @param response - Raw response from provider
   * @throws ResponseValidationError if validation fails
   */
  validateRawResponse(response: unknown): void {
    // Check response exists
    if (response === null || response === undefined) {
      throw new ResponseValidationError('Response is null or undefined', 'EMPTY_RESPONSE', response)
    }

    // Check response is an object
    if (typeof response !== 'object') {
      throw new ResponseValidationError(
        `Response is not an object: ${typeof response}`,
        'EMPTY_RESPONSE',
        response
      )
    }
  },

  /**
   * Validate complete response after parsing
   *
   * Runs all validation checks on raw response, message array, and last message.
   *
   * @param response - Raw response from provider
   * @param messages - Parsed messages from formatter
   * @returns Last message if all validations pass
   * @throws ResponseValidationError if any validation fails
   */
  validateResponse(response: unknown, messages: InternalMessage[]): InternalMessage {
    // Validate raw response
    this.validateRawResponse(response)

    // Validate message array
    this.validateMessageArray(messages)

    // Get and validate last message
    const lastMessage = messages.at(-1)!
    this.validateMessage(lastMessage)

    return lastMessage
  },
} as const

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /**
   * Whether to increase temperature on retry
   * @default true
   */
  adjustTemperature?: boolean

  /**
   * Initial delay in milliseconds before first retry
   * @default 1000
   */
  initialDelayMs?: number

  /**
   * Maximum number of retry attempts
   * @default 2
   */
  maxAttempts?: number

  /**
   * Maximum temperature value
   * @default 1
   */
  maxTemperature?: number

  /**
   * Temperature increment for each retry
   * @default 0.2
   */
  temperatureIncrement?: number
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  adjustTemperature: true,
  initialDelayMs: 1000,
  maxAttempts: 2,
  maxTemperature: 1,
  temperatureIncrement: 0.2,
}

/**
 * Helper object for retry logic with exponential backoff
 */
export const RetryHelper = {
  /**
   * Adjust temperature for retry attempt
   *
   * Increases temperature to encourage different responses on retry.
   *
   * @param currentTemperature - Current temperature value
   * @param config - Retry configuration
   * @returns Adjusted temperature
   */
  adjustTemperature(currentTemperature: number, config: Required<RetryConfig>): number {
    if (!config.adjustTemperature) {
      return currentTemperature
    }

    const newTemperature = currentTemperature + config.temperatureIncrement
    return Math.min(newTemperature, config.maxTemperature)
  },

  /**
   * Calculate delay for a given retry attempt
   *
   * Uses exponential backoff: delay * 2^attempt
   *
   * @param attempt - Current attempt number (0-indexed)
   * @param initialDelay - Initial delay in milliseconds
   * @returns Delay in milliseconds
   */
  calculateDelay(attempt: number, initialDelay: number): number {
    return initialDelay * (2 ** attempt)
  },

  /**
   * Check if error is retryable
   *
   * Only retry validation errors, not other types of errors.
   *
   * @param error - Error to check
   * @returns True if error should be retried
   */
  isRetryableError(error: unknown): boolean {
    return error instanceof ResponseValidationError
  },

  /**
   * Sleep for specified milliseconds
   *
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after delay
   */
  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve()
      }, ms)
    })
  },
} as const
