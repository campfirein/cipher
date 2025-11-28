/**
 * Retry Policy Configuration.
 *
 * Defines retry behavior for LLM operations with exponential backoff.
 * Based on patterns from gemini-cli for consistent retry handling.
 */

/**
 * Configuration for retry behavior.
 */
export interface RetryPolicy {
  /** Multiplier for exponential backoff (e.g., 2 = double delay each time) */
  backoffMultiplier: number
  /** Base delay in milliseconds before first retry */
  baseDelayMs: number
  /** Jitter factor (0-1) to randomize delays and prevent thundering herd */
  jitterFactor: number
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number
  /** Maximum number of retry attempts (0 = no retries) */
  maxRetries: number
  /** Error types/messages that should trigger a retry */
  retryableErrors: string[]
  /** HTTP status codes that should trigger a retry */
  retryableStatusCodes: number[]
}

/**
 * Default retry policy with sensible defaults.
 *
 * - 3 retry attempts
 * - Starting at 1 second, max 30 seconds
 * - 2x exponential backoff
 * - 25% jitter
 * - Retries on common transient errors (429, 500, 502, 503, 504)
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  backoffMultiplier: 2,
  baseDelayMs: 1000,
  jitterFactor: 0.25,
  maxDelayMs: 30_000,
  maxRetries: 3,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'rate_limit',
    'overloaded',
    'capacity',
    'timeout',
    'temporarily unavailable',
  ],
  retryableStatusCodes: [429, 500, 502, 503, 504],
}

/**
 * Aggressive retry policy for critical operations.
 *
 * More retries with longer delays for operations that must succeed.
 */
export const AGGRESSIVE_RETRY_POLICY: RetryPolicy = {
  backoffMultiplier: 2,
  baseDelayMs: 2000,
  jitterFactor: 0.3,
  maxDelayMs: 60_000,
  maxRetries: 5,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'rate_limit',
    'overloaded',
    'capacity',
    'timeout',
    'temporarily unavailable',
  ],
  retryableStatusCodes: [429, 500, 502, 503, 504],
}

/**
 * Minimal retry policy for fast-fail scenarios.
 *
 * Single retry with short delay when quick feedback is preferred.
 */
export const MINIMAL_RETRY_POLICY: RetryPolicy = {
  backoffMultiplier: 2,
  baseDelayMs: 500,
  jitterFactor: 0.1,
  maxDelayMs: 2000,
  maxRetries: 1,
  retryableErrors: ['rate_limit', 'overloaded'],
  retryableStatusCodes: [429, 503],
}

/**
 * No retry policy - fail immediately on any error.
 */
export const NO_RETRY_POLICY: RetryPolicy = {
  backoffMultiplier: 1,
  baseDelayMs: 0,
  jitterFactor: 0,
  maxDelayMs: 0,
  maxRetries: 0,
  retryableErrors: [],
  retryableStatusCodes: [],
}

/**
 * Create a custom retry policy by merging with defaults.
 *
 * @param overrides - Partial policy to override defaults
 * @returns Complete retry policy
 */
export function createRetryPolicy(overrides: Partial<RetryPolicy>): RetryPolicy {
  return {
    ...DEFAULT_RETRY_POLICY,
    ...overrides,
  }
}

/**
 * Check if an error should be retried based on the policy.
 *
 * @param error - The error to check
 * @param policy - The retry policy to use
 * @returns True if the error is retryable
 */
export function isRetryableError(error: unknown, policy: RetryPolicy): boolean {
  // Check if we have any retry configuration
  if (policy.maxRetries === 0) {
    return false
  }

  // Handle HTTP-like errors with status codes
  if (error && typeof error === 'object') {
    const errorObj = error as Record<string, unknown>

    // Check status code
    const status = errorObj.status ?? errorObj.statusCode ?? errorObj.code
    if (typeof status === 'number' && policy.retryableStatusCodes.includes(status)) {
      return true
    }

    // Check for gRPC status codes (common transient errors)
    const grpcCode = errorObj.code
    // gRPC codes: 14 = UNAVAILABLE, 8 = RESOURCE_EXHAUSTED, 4 = DEADLINE_EXCEEDED
    if (typeof grpcCode === 'number' && [4, 8, 14].includes(grpcCode)) {
      return true
    }
  }

  // Check error message against retryable patterns
  const errorMessage = error instanceof Error ? error.message : String(error)
  const lowerMessage = errorMessage.toLowerCase()

  return policy.retryableErrors.some((pattern) => lowerMessage.includes(pattern.toLowerCase()))
}

/**
 * Calculate delay for a specific retry attempt with exponential backoff and jitter.
 *
 * @param attempt - Current retry attempt (1-based)
 * @param policy - The retry policy to use
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(attempt: number, policy: RetryPolicy): number {
  // Calculate base exponential delay
  const exponentialDelay = policy.baseDelayMs * policy.backoffMultiplier ** (attempt - 1)

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, policy.maxDelayMs)

  // Apply jitter (randomize within jitter factor range)
  const jitterRange = cappedDelay * policy.jitterFactor
  const jitter = Math.random() * jitterRange * 2 - jitterRange

  // Ensure delay is at least 0
  return Math.max(0, Math.round(cappedDelay + jitter))
}
