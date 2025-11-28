/**
 * Retry with Backoff Utility.
 *
 * Provides a generic retry mechanism with exponential backoff for async operations.
 * Used by RetryableContentGenerator and can be used for other retry scenarios.
 */

import {
  calculateRetryDelay,
  DEFAULT_RETRY_POLICY,
  isRetryableError,
  type RetryPolicy,
} from './retry-policy.js'

/**
 * Context provided to retry callbacks.
 */
export interface RetryContext {
  /** Current attempt number (1-based) */
  attempt: number
  /** Delay before next retry in milliseconds */
  delayMs: number
  /** The error that triggered the retry */
  error: unknown
  /** Maximum number of attempts */
  maxAttempts: number
}

/**
 * Options for the retry operation.
 */
export interface RetryOptions {
  /** Custom function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean
  /** Callback invoked when all retries are exhausted */
  onExhausted?: (context: RetryContext) => void
  /** Callback invoked before each retry attempt */
  onRetry?: (context: RetryContext) => void
  /** Retry policy configuration */
  policy?: RetryPolicy
  /** Abort signal to cancel retries */
  signal?: AbortSignal
}

/**
 * Result of a retry operation.
 */
export interface RetryResult<T> {
  /** Number of attempts made */
  attempts: number
  /** The final error if failed */
  error?: unknown
  /** The result if successful */
  result?: T
  /** Whether the operation succeeded */
  success: boolean
  /** Total time spent in milliseconds */
  totalTimeMs: number
}

/**
 * Sleep for a specified duration.
 *
 * @param ms - Duration in milliseconds
 * @param signal - Optional abort signal
 * @returns Promise that resolves after the delay
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Retry aborted'))
      return
    }

    const timeout = setTimeout(resolve, ms)

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(new Error('Retry aborted'))
    })
  })
}

/**
 * Execute an async operation with retry and exponential backoff.
 *
 * @param operation - The async operation to execute
 * @param options - Retry options
 * @returns Promise resolving to the operation result or throwing after all retries exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetchData(),
 *   {
 *     policy: DEFAULT_RETRY_POLICY,
 *     onRetry: ({ attempt, delayMs }) => {
 *       console.log(`Retry ${attempt}, waiting ${delayMs}ms`)
 *     }
 *   }
 * )
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY
  const maxAttempts = policy.maxRetries + 1
  return attemptWithRetry({
    attempt: 1,
    maxAttempts,
    operation,
    options,
    policy,
  })
}

/**
 * Internal options for retry attempt.
 */
interface AttemptOptions<T> {
  attempt: number
  maxAttempts: number
  operation: () => Promise<T>
  options: RetryOptions
  policy: RetryPolicy
}

/**
 * Internal helper to attempt retry recursively.
 */
async function attemptWithRetry<T>(config: AttemptOptions<T>): Promise<T> {
  const {attempt, maxAttempts, operation, options, policy} = config

  // Check if aborted
  if (options.signal?.aborted) {
    throw new Error('Retry aborted')
  }

  try {
    return await operation()
  } catch (error) {
    // Check if this is the last attempt
    if (attempt >= maxAttempts) {
      const context: RetryContext = {
        attempt,
        delayMs: 0,
        error,
        maxAttempts,
      }
      options.onExhausted?.(context)
      throw error
    }

    // Check if error is retryable
    const isRetryable = options.isRetryable?.(error) ?? isRetryableError(error, policy)
    if (!isRetryable) {
      throw error
    }

    // Calculate delay and invoke callback
    const delayMs = calculateRetryDelay(attempt, policy)
    const context: RetryContext = {
      attempt,
      delayMs,
      error,
      maxAttempts,
    }
    options.onRetry?.(context)

    // Wait before retrying
    await sleep(delayMs, options.signal)

    // Recursively attempt again
    return attemptWithRetry({
      attempt: attempt + 1,
      maxAttempts,
      operation,
      options,
      policy,
    })
  }
}

/**
 * Execute an async operation with retry and return a detailed result.
 *
 * Unlike `withRetry`, this function never throws and always returns a result object.
 *
 * @param operation - The async operation to execute
 * @param options - Retry options
 * @returns Promise resolving to a RetryResult object
 *
 * @example
 * ```typescript
 * const { success, result, error, attempts } = await withRetryResult(
 *   () => fetchData(),
 *   { policy: DEFAULT_RETRY_POLICY }
 * )
 *
 * if (success) {
 *   console.log('Data:', result)
 * } else {
 *   console.error('Failed after', attempts, 'attempts:', error)
 * }
 * ```
 */
export async function withRetryResult<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY
  const maxAttempts = policy.maxRetries + 1
  const startTime = Date.now()
  return attemptWithRetryResult({
    attempt: 1,
    maxAttempts,
    operation,
    options,
    policy,
    startTime,
  })
}

/**
 * Internal options for retry attempt with result tracking.
 */
interface AttemptResultOptions<T> {
  attempt: number
  maxAttempts: number
  operation: () => Promise<T>
  options: RetryOptions
  policy: RetryPolicy
  startTime: number
}

/**
 * Internal helper to attempt retry recursively with result tracking.
 */
async function attemptWithRetryResult<T>(config: AttemptResultOptions<T>): Promise<RetryResult<T>> {
  const {attempt, maxAttempts, operation, options, policy, startTime} = config

  // Check if aborted
  if (options.signal?.aborted) {
    return {
      attempts: attempt,
      error: new Error('Retry aborted'),
      success: false,
      totalTimeMs: Date.now() - startTime,
    }
  }

  try {
    const result = await operation()
    return {
      attempts: attempt,
      result,
      success: true,
      totalTimeMs: Date.now() - startTime,
    }
  } catch (error) {
    // Check if this is the last attempt
    if (attempt >= maxAttempts) {
      const context: RetryContext = {
        attempt,
        delayMs: 0,
        error,
        maxAttempts,
      }
      options.onExhausted?.(context)
      return {
        attempts: attempt,
        error,
        success: false,
        totalTimeMs: Date.now() - startTime,
      }
    }

    // Check if error is retryable
    const isRetryable = options.isRetryable?.(error) ?? isRetryableError(error, policy)
    if (!isRetryable) {
      return {
        attempts: attempt,
        error,
        success: false,
        totalTimeMs: Date.now() - startTime,
      }
    }

    // Calculate delay and invoke callback
    const delayMs = calculateRetryDelay(attempt, policy)
    const context: RetryContext = {
      attempt,
      delayMs,
      error,
      maxAttempts,
    }
    options.onRetry?.(context)

    // Wait before retrying
    try {
      await sleep(delayMs, options.signal)
    } catch {
      // Aborted during sleep
      return {
        attempts: attempt,
        error: new Error('Retry aborted'),
        success: false,
        totalTimeMs: Date.now() - startTime,
      }
    }

    // Recursively attempt again
    return attemptWithRetryResult({
      attempt: attempt + 1,
      maxAttempts,
      operation,
      options,
      policy,
      startTime,
    })
  }
}

/**
 * Create a retryable version of an async function.
 *
 * @param fn - The async function to wrap
 * @param options - Retry options
 * @returns A new function that will retry on failure
 *
 * @example
 * ```typescript
 * const retryableFetch = makeRetryable(
 *   (url: string) => fetch(url).then(r => r.json()),
 *   { policy: DEFAULT_RETRY_POLICY }
 * )
 *
 * const data = await retryableFetch('https://api.example.com/data')
 * ```
 */
export function makeRetryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {},
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), options)
}
