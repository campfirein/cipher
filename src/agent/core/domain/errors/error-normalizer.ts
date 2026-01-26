/**
 * Error Normalizer
 *
 * Converts various error types into a unified, normalized format.
 * Following the OpenCode pattern of MessageV2.fromError() for consistent
 * error handling across providers.
 *
 * Key features:
 * - Discriminated union for error types
 * - Provider-agnostic error representation
 * - Retryable error detection
 * - Consistent error structure for UI consumption
 */

import {
  LlmConfigurationError,
  LlmError,
  LlmGenerationError,
  LlmMaxIterationsError,
  LlmMissingToolExecutorError,
  LlmRateLimitError,
  LlmResponseParsingError,
  LlmToolExecutionError,
} from './llm-error.js'
import {SessionCancelledError} from './session-error.js'
import {ToolError} from './tool-error.js'

/**
 * Normalized error types following OpenCode pattern.
 * Discriminated by the `type` field for easy pattern matching.
 */
export type NormalizedError =
  | NormalizedAbortedError
  | NormalizedApiError
  | NormalizedAuthError
  | NormalizedConfigError
  | NormalizedOutputLengthError
  | NormalizedRateLimitError
  | NormalizedToolError
  | NormalizedUnknownError

/**
 * Authentication/authorization error.
 */
export interface NormalizedAuthError {
  /** Error message */
  message: string
  /** Provider that rejected auth */
  providerId: string
  type: 'auth'
}

/**
 * API call error (network, server errors, etc.).
 */
export interface NormalizedApiError {
  /** Whether this error can be retried */
  isRetryable: boolean
  /** Error message */
  message: string
  /** Model that was being used */
  model?: string
  /** Provider that returned the error */
  providerId?: string
  /** HTTP status code if available */
  statusCode?: number
  type: 'api'
}

/**
 * Request was aborted/cancelled.
 */
export interface NormalizedAbortedError {
  /** Error message */
  message: string
  type: 'aborted'
}

/**
 * Output length exceeded (max tokens).
 */
export interface NormalizedOutputLengthError {
  /** Maximum tokens that were allowed */
  maxTokens?: number
  /** Error message */
  message: string
  type: 'output_length'
}

/**
 * Rate limit exceeded.
 */
export interface NormalizedRateLimitError {
  /** Error message */
  message: string
  /** Provider that rate limited */
  providerId: string
  /** When to retry (seconds) */
  retryAfter?: number
  type: 'rate_limit'
}

/**
 * Tool execution error.
 */
export interface NormalizedToolError {
  /** Error message */
  message: string
  /** Name of the tool that failed */
  toolName: string
  type: 'tool'
}

/**
 * Configuration error.
 */
export interface NormalizedConfigError {
  /** Configuration key that's problematic */
  configKey: string
  /** Error message */
  message: string
  /** Provider if applicable */
  providerId?: string
  type: 'config'
}

/**
 * Unknown/unclassified error.
 */
export interface NormalizedUnknownError {
  /** Error message */
  message: string
  /** Original error if available */
  originalError?: Error
  type: 'unknown'
}

/**
 * Context for error normalization.
 */
export interface ErrorContext {
  /** Model being used */
  model?: string
  /** Provider being used */
  providerId?: string
  /** Session ID if applicable */
  sessionId?: string
}

/**
 * Normalize abort-related errors.
 */
function normalizeAbortError(error: unknown): NormalizedAbortedError | null {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      message: error.message || 'Operation was aborted',
      type: 'aborted',
    }
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return {
      message: error.message || 'Operation was aborted',
      type: 'aborted',
    }
  }

  if (error instanceof SessionCancelledError) {
    return {
      message: error.message,
      type: 'aborted',
    }
  }

  return null
}

/**
 * Normalize LLM rate limit errors.
 */
function normalizeLlmRateLimitError(error: LlmRateLimitError, context?: ErrorContext): NormalizedRateLimitError {
  return {
    message: error.message,
    providerId: error.provider ?? context?.providerId ?? 'unknown',
    retryAfter: error.retryAfter,
    type: 'rate_limit',
  }
}

/**
 * Normalize LLM configuration errors.
 */
function normalizeLlmConfigError(error: LlmConfigurationError, context?: ErrorContext): NormalizedConfigError {
  return {
    configKey: error.configKey,
    message: error.message,
    providerId: error.provider ?? context?.providerId,
    type: 'config',
  }
}

/**
 * Normalize LLM tool execution errors.
 */
function normalizeLlmToolExecutionError(error: LlmToolExecutionError): NormalizedToolError {
  return {
    message: error.message,
    toolName: error.toolName,
    type: 'tool',
  }
}

/**
 * Normalize LLM max iterations errors.
 */
function normalizeLlmMaxIterationsError(error: LlmMaxIterationsError): NormalizedOutputLengthError {
  return {
    maxTokens: error.maxIterations,
    message: error.message,
    type: 'output_length',
  }
}

/**
 * Normalize LLM response parsing errors.
 */
function normalizeLlmResponseParsingError(error: LlmResponseParsingError, context?: ErrorContext): NormalizedApiError {
  return {
    isRetryable: false,
    message: error.message,
    model: error.model ?? context?.model,
    providerId: error.provider ?? context?.providerId,
    type: 'api',
  }
}

/**
 * Normalize LLM missing tool executor errors.
 */
function normalizeLlmMissingToolExecutorError(error: LlmMissingToolExecutorError, context?: ErrorContext): NormalizedConfigError {
  return {
    configKey: 'toolExecutor',
    message: error.message,
    providerId: error.provider ?? context?.providerId,
    type: 'config',
  }
}

/**
 * Normalize LLM generation errors.
 */
function normalizeLlmGenerationError(error: LlmGenerationError, context?: ErrorContext): NormalizedApiError {
  const isRetryable = isRetryableError(error)
  return {
    isRetryable,
    message: error.message,
    model: error.model ?? context?.model,
    providerId: error.provider ?? context?.providerId,
    type: 'api',
  }
}

/**
 * Normalize generic LLM errors.
 */
function normalizeGenericLlmError(error: LlmError, context?: ErrorContext): NormalizedApiError {
  const isRetryable = isRetryableError(error)
  return {
    isRetryable,
    message: error.message,
    model: error.model ?? context?.model,
    providerId: error.provider ?? context?.providerId,
    type: 'api',
  }
}

/**
 * Normalize LLM-specific errors.
 */
function normalizeLlmError(error: unknown, context?: ErrorContext): NormalizedError | null {
  if (error instanceof LlmRateLimitError) {
    return normalizeLlmRateLimitError(error, context)
  }

  if (error instanceof LlmConfigurationError) {
    return normalizeLlmConfigError(error, context)
  }

  if (error instanceof LlmToolExecutionError) {
    return normalizeLlmToolExecutionError(error)
  }

  if (error instanceof LlmMaxIterationsError) {
    return normalizeLlmMaxIterationsError(error)
  }

  if (error instanceof LlmResponseParsingError) {
    return normalizeLlmResponseParsingError(error, context)
  }

  if (error instanceof LlmMissingToolExecutorError) {
    return normalizeLlmMissingToolExecutorError(error, context)
  }

  if (error instanceof LlmGenerationError) {
    return normalizeLlmGenerationError(error, context)
  }

  if (error instanceof LlmError) {
    return normalizeGenericLlmError(error, context)
  }

  return null
}

/**
 * Normalize tool-related errors.
 */
function normalizeToolError(error: unknown): NormalizedToolError | null {
  if (error instanceof ToolError) {
    const toolName = (error.details?.toolName as string) ?? 'unknown'
    return {
      message: error.message,
      toolName,
      type: 'tool',
    }
  }

  return null
}

/**
 * Normalize generic Error instances.
 */
function normalizeGenericError(error: Error, context?: ErrorContext): NormalizedError {
  if (isAuthError(error)) {
    return {
      message: error.message,
      providerId: context?.providerId ?? 'unknown',
      type: 'auth',
    }
  }

  if (isRateLimitPattern(error.message)) {
    return {
      message: error.message,
      providerId: context?.providerId ?? 'unknown',
      type: 'rate_limit',
    }
  }

  return {
    message: error.message,
    originalError: error,
    type: 'unknown',
  }
}

/**
 * Normalize any error into a consistent format.
 *
 * This function handles all known error types and converts them
 * to a unified NormalizedError format for consistent handling.
 *
 * @param error - The error to normalize
 * @param context - Optional context about the operation
 * @returns Normalized error with consistent structure
 *
 * @example
 * ```typescript
 * try {
 *   await llm.generate(prompt)
 * } catch (error) {
 *   const normalized = normalizeError(error, { providerId: 'claude' })
 *
 *   switch (normalized.type) {
 *     case 'rate_limit':
 *       await sleep(normalized.retryAfter * 1000)
 *       break
 *     case 'auth':
 *       showLoginPrompt()
 *       break
 *     default:
 *       logError(normalized.message)
 *   }
 * }
 * ```
 */
export function normalizeError(error: unknown, context?: ErrorContext): NormalizedError {
  if (error === null || error === undefined) {
    return {
      message: 'Unknown error occurred',
      type: 'unknown',
    }
  }

  const abortError = normalizeAbortError(error)
  if (abortError) {
    return abortError
  }

  const llmError = normalizeLlmError(error, context)
  if (llmError) {
    return llmError
  }

  const toolError = normalizeToolError(error)
  if (toolError) {
    return toolError
  }

  if (error instanceof Error) {
    return normalizeGenericError(error, context)
  }

  if (typeof error === 'string') {
    return {
      message: error,
      type: 'unknown',
    }
  }

  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return {
      message: error.message,
      type: 'unknown',
    }
  }

  return {
    message: String(error),
    type: 'unknown',
  }
}

/**
 * Check if an error is retryable.
 */
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase()

  // Network errors are usually retryable
  if (message.includes('network') || message.includes('timeout') || message.includes('econnreset')) {
    return true
  }

  // Server errors (5xx) are usually retryable
  if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
    return true
  }

  // Rate limits are retryable
  if (message.includes('rate limit') || message.includes('too many requests') || message.includes('429')) {
    return true
  }

  // Overloaded errors are retryable
  if (message.includes('overloaded') || message.includes('capacity')) {
    return true
  }

  return false
}

/**
 * Check if an error looks like an auth error.
 */
function isAuthError(error: Error): boolean {
  const message = error.message.toLowerCase()

  return (
    message.includes('unauthorized') ||
    message.includes('authentication') ||
    message.includes('api key') ||
    message.includes('invalid key') ||
    message.includes('401') ||
    message.includes('403')
  )
}

/**
 * Check if a message looks like a rate limit error.
 */
function isRateLimitPattern(message: string): boolean {
  const lower = message.toLowerCase()

  return (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('429') ||
    lower.includes('quota exceeded')
  )
}

/**
 * Check if a normalized error is retryable.
 */
export function isNormalizedErrorRetryable(error: NormalizedError): boolean {
  switch (error.type) {
    case 'aborted': {
      return false
    }

    case 'api': {
      return error.isRetryable
    }

    case 'auth': {
      return false
    }

    case 'config': {
      return false
    }

    case 'output_length': {
      return false
    }

    case 'rate_limit': {
      return true
    }

    case 'tool': {
      return false
    }

    case 'unknown': {
      return false
    }
  }
}

/**
 * Get a user-friendly message for a normalized error.
 */
export function getErrorDisplayMessage(error: NormalizedError): string {
  switch (error.type) {
    case 'aborted': {
      return 'Operation was cancelled.'
    }

    case 'api': {
      return error.isRetryable
        ? 'Temporary error. Please try again.'
        : `API error: ${error.message}`
    }

    case 'auth': {
      return `Authentication failed with ${error.providerId}. Please check your API key.`
    }

    case 'config': {
      return `Configuration error: ${error.message}`
    }

    case 'output_length': {
      return 'Response was too long and was truncated.'
    }

    case 'rate_limit': {
      return error.retryAfter
        ? `Rate limit exceeded. Retry in ${error.retryAfter} seconds.`
        : 'Rate limit exceeded. Please wait and try again.'
    }

    case 'tool': {
      return `Tool "${error.toolName}" failed: ${error.message}`
    }

    case 'unknown': {
      return error.message || 'An unexpected error occurred.'
    }
  }
}
