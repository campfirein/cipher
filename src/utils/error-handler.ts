/**
 * Centralized error handling utility for CLI commands
 *
 * Provides user-friendly error messages based on error type:
 * - Network errors: Check internet connection
 * - Server errors: Retry later
 * - Billing errors: Check account/payment
 * - Auth errors: Re-login required
 * - Validation errors: Check input
 */

import {isAxiosError} from 'axios'

import {addErrorPrefix} from './emoji-helpers.js'

export enum ErrorType {
  AUTH = 'AUTH',
  BILLING = 'BILLING',
  NETWORK = 'NETWORK',
  SERVER = 'SERVER',
  UNKNOWN = 'UNKNOWN',
  VALIDATION = 'VALIDATION',
}

export interface ClassifiedError {
  message: string
  originalError: Error
  type: ErrorType
  userMessage: string
}

/**
 * Helper to create a ClassifiedError object
 */
function createClassifiedError(
  err: Error,
  type: ErrorType,
  userMessage: string,
  customMessage?: string,
): ClassifiedError {
  return {
    message: customMessage || err.message,
    originalError: err,
    type,
    userMessage,
  }
}

/**
 * Classify axios-specific errors
 * Returns null if error is not an axios error
 */
function classifyAxiosError(error: unknown, err: Error): ClassifiedError | null {
  if (!isAxiosError(error)) {
    return null
  }

  // Network connectivity issues
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return createClassifiedError(
      err,
      ErrorType.NETWORK,
      '❌ Network error: Unable to connect to ByteRover servers. Please check your internet connection and try again.',
    )
  }

  // DNS resolution failed
  if (error.code === 'EAI_AGAIN') {
    return createClassifiedError(
      err,
      ErrorType.NETWORK,
      '❌ Network error: DNS resolution failed. Please check your internet connection and DNS settings.',
    )
  }

  // Server returned error response
  if (error.response) {
    const {status} = error.response

    // Authentication errors (401, 403)
    if (status === 401 || status === 403) {
      return createClassifiedError(
        err,
        ErrorType.AUTH,
        '❌ Authentication failed: Your session has expired or is invalid. Please run "brv login" to re-authenticate.',
      )
    }

    // Billing/quota errors (402, 429)
    if (status === 402 || status === 429) {
      return createClassifiedError(
        err,
        ErrorType.BILLING,
        '❌ Billing error: Your ByteRover account may not have sufficient credits or has reached quota limits. Please check your account settings.',
      )
    }

    // Server errors (500, 502, 503, 504)
    if (status >= 500) {
      return createClassifiedError(
        err,
        ErrorType.SERVER,
        '❌ Server error: ByteRover servers are experiencing issues. Please try again in a few moments.',
      )
    }

    // Client errors (400, 404, etc.)
    if (status >= 400 && status < 500) {
      // Try to extract error message from response
      const responseData = error.response.data
      const errorMessage =
        typeof responseData === 'string' ? responseData : responseData?.message || responseData?.error || err.message

      return createClassifiedError(err, ErrorType.VALIDATION, `❌ Request error: ${errorMessage}`, errorMessage)
    }
  }

  // Request was made but no response received
  if (error.request) {
    return createClassifiedError(
      err,
      ErrorType.NETWORK,
      '❌ Network error: No response from ByteRover servers. Please check your internet connection and try again.',
    )
  }

  return null
}

/**
 * Classify error based on message keywords
 * Returns null if no keywords match
 */
function classifyByMessageKeywords(err: Error): ClassifiedError | null {
  const errorMessage = err.message.toLowerCase()

  // Network-related keywords
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('enotfound') ||
    errorMessage.includes('econnrefused')
  ) {
    return createClassifiedError(
      err,
      ErrorType.NETWORK,
      '❌ Network error: Unable to connect to ByteRover servers. Please check your internet connection and try again.',
    )
  }

  // Authentication keywords
  if (
    errorMessage.includes('authentication') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('forbidden') ||
    errorMessage.includes('token') ||
    errorMessage.includes('login')
  ) {
    return createClassifiedError(
      err,
      ErrorType.AUTH,
      '❌ Authentication failed: Your session has expired or is invalid. Please run "brv login" to re-authenticate.',
    )
  }

  // Billing keywords
  if (
    errorMessage.includes('billing') ||
    errorMessage.includes('quota') ||
    errorMessage.includes('limit') ||
    errorMessage.includes('credits') ||
    errorMessage.includes('payment')
  ) {
    return createClassifiedError(
      err,
      ErrorType.BILLING,
      '❌ Billing error: Your ByteRover account may not have sufficient credits or has reached quota limits. Please check your account settings.',
    )
  }

  // Validation keywords
  if (
    errorMessage.includes('invalid') ||
    errorMessage.includes('required') ||
    errorMessage.includes('missing') ||
    errorMessage.includes('validation')
  ) {
    return createClassifiedError(err, ErrorType.VALIDATION, `❌ Validation error: ${err.message}`)
  }

  return null
}

/**
 * Classify error and return user-friendly message
 */
export function classifyError(error: unknown): ClassifiedError {
  const err = error instanceof Error ? error : new Error(String(error))

  // Try axios error classification first
  const axiosResult = classifyAxiosError(error, err)
  if (axiosResult) {
    return axiosResult
  }

  // Try message-based classification
  const messageResult = classifyByMessageKeywords(err)
  if (messageResult) {
    return messageResult
  }

  // Default: unknown error
  // Don't add prefix if error message already has emoji prefix
  return createClassifiedError(err, ErrorType.UNKNOWN, addErrorPrefix(err.message))
}

/**
 * Format error for display to user
 *
 * @param error - Error to format
 * @returns User-friendly error message
 */
export function formatError(error: unknown): string {
  const classified = classifyError(error)
  return classified.userMessage
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  return classifyError(error).type === ErrorType.NETWORK
}

/**
 * Check if error is a server error
 */
export function isServerError(error: unknown): boolean {
  return classifyError(error).type === ErrorType.SERVER
}

/**
 * Check if error is an authentication error
 */
export function isAuthError(error: unknown): boolean {
  return classifyError(error).type === ErrorType.AUTH
}

/**
 * Check if error is a billing error
 */
export function isBillingError(error: unknown): boolean {
  return classifyError(error).type === ErrorType.BILLING
}
