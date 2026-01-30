/**
 * LLM Error Codes
 *
 * Centralized error codes for LLM-related operations.
 * Following Dexto's pattern for typed error handling.
 */

/**
 * LLM-specific error codes.
 */
export const LLMErrorCode = {
  // Configuration errors
  API_KEY_INVALID: 'LLM_API_KEY_INVALID',
  API_KEY_MISSING: 'LLM_API_KEY_MISSING',
  BASE_URL_INVALID: 'LLM_BASE_URL_INVALID',
  BASE_URL_MISSING: 'LLM_BASE_URL_MISSING',

  // Context errors
  COMPRESSION_FAILED: 'LLM_COMPRESSION_FAILED',
  CONTEXT_OVERFLOW: 'LLM_CONTEXT_OVERFLOW',

  // Operation errors
  GENERATION_FAILED: 'LLM_GENERATION_FAILED',

  // Input validation errors
  INPUT_FILE_UNSUPPORTED: 'LLM_INPUT_FILE_UNSUPPORTED',
  INPUT_IMAGE_UNSUPPORTED: 'LLM_INPUT_IMAGE_UNSUPPORTED',
  INPUT_TEXT_INVALID: 'LLM_INPUT_TEXT_INVALID',

  // Model errors
  MODEL_INCOMPATIBLE: 'LLM_MODEL_INCOMPATIBLE',
  MODEL_UNKNOWN: 'LLM_MODEL_UNKNOWN',
  PROVIDER_UNSUPPORTED: 'LLM_PROVIDER_UNSUPPORTED',

  // Limit errors
  RATE_LIMIT_EXCEEDED: 'LLM_RATE_LIMIT_EXCEEDED',
  REQUEST_INVALID_SCHEMA: 'LLM_REQUEST_INVALID_SCHEMA',
  SWITCH_FAILED: 'LLM_SWITCH_FAILED',
  SWITCH_INPUT_MISSING: 'LLM_SWITCH_INPUT_MISSING',
  TOKENS_EXCEEDED: 'LLM_TOKENS_EXCEEDED',
} as const

/**
 * Type for LLM error codes.
 */
export type LLMErrorCodeType = (typeof LLMErrorCode)[keyof typeof LLMErrorCode]

/**
 * Error scope for categorizing errors.
 */
export const ErrorScope = {
  CONFIG: 'config',
  LLM: 'llm',
  VALIDATION: 'validation',
} as const

export type ErrorScopeType = (typeof ErrorScope)[keyof typeof ErrorScope]

/**
 * Error type for categorizing error severity.
 */
export const ErrorType = {
  SYSTEM: 'system', // System/infrastructure error
  TRANSIENT: 'transient', // Temporary error (retry may help)
  USER: 'user', // User-correctable error
} as const

export type ErrorTypeValue = (typeof ErrorType)[keyof typeof ErrorType]
