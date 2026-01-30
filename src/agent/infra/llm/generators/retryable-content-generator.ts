/**
 * Retryable Content Generator Decorator.
 *
 * Wraps any IContentGenerator to add retry capabilities with exponential backoff.
 * Handles transient errors like rate limits, timeouts, and server errors.
 */

import type {
  GenerateContentChunk,
  GenerateContentRequest,
  GenerateContentResponse,
  IContentGenerator,
} from '../../../core/interfaces/i-content-generator.js'
import type {SessionEventBus} from '../../events/event-emitter.js'

import {
  calculateRetryDelay,
  DEFAULT_RETRY_POLICY,
  isRetryableError,
  type RetryPolicy,
} from '../retry/retry-policy.js'

/**
 * Options for the RetryableContentGenerator.
 */
export interface RetryableOptions {
  /** Event bus for emitting retry events */
  eventBus?: SessionEventBus
  /** Retry policy configuration */
  policy?: RetryPolicy
}

/**
 * Retryable Content Generator.
 *
 * Decorator that wraps any IContentGenerator to add retry capabilities.
 * Uses exponential backoff with jitter to handle transient failures gracefully.
 *
 * Features:
 * - Configurable retry policy
 * - Exponential backoff with jitter
 * - Retries on rate limits, timeouts, and server errors
 * - Event emission for retry attempts
 * - Streaming support with full request retry
 */
export class RetryableContentGenerator implements IContentGenerator {
  private readonly eventBus?: SessionEventBus
  private readonly inner: IContentGenerator
  private readonly policy: RetryPolicy

  /**
   * Create a new Retryable Content Generator.
   *
   * @param inner - The wrapped content generator
   * @param options - Retry options
   */
  constructor(inner: IContentGenerator, options: RetryableOptions = {}) {
    this.inner = inner
    this.policy = options.policy ?? DEFAULT_RETRY_POLICY
    this.eventBus = options.eventBus
  }

  /**
   * Estimate tokens (delegates to inner generator).
   *
   * @param content - Text to estimate tokens for
   * @returns Estimated token count
   */
  public estimateTokensSync(content: string): number {
    return this.inner.estimateTokensSync(content)
  }

  /**
   * Generate content with retry.
   *
   * @param request - Generation request
   * @returns Generated content response
   */
  public async generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse> {
    const maxAttempts = this.policy.maxRetries + 1
    return this.attemptGenerateContent(request, 1, maxAttempts)
  }

  /**
   * Generate content with streaming and retry.
   *
   * Note: For streaming, we retry the entire request if an error occurs.
   * This is because partial streams cannot be resumed mid-way.
   *
   * @param request - Generation request
   * @yields Content chunks as they are generated
   * @returns Async generator yielding content chunks
   */
  public async *generateContentStream(
    request: GenerateContentRequest,
  ): AsyncGenerator<GenerateContentChunk> {
    const maxAttempts = this.policy.maxRetries + 1
    yield* this.attemptGenerateContentStream(request, 1, maxAttempts)
  }

  /**
   * Attempt to generate content with retry logic.
   */
  private async attemptGenerateContent(
    request: GenerateContentRequest,
    attempt: number,
    maxAttempts: number,
  ): Promise<GenerateContentResponse> {
    try {
      return await this.inner.generateContent(request)
    } catch (error) {
      // Check if this is the last attempt
      if (attempt >= maxAttempts) {
        this.emitExhausted(attempt, error)
        throw error
      }

      // Check if error is retryable
      if (!isRetryableError(error, this.policy)) {
        throw error
      }

      // Calculate delay and emit retry event
      const delayMs = calculateRetryDelay(attempt, this.policy)
      this.emitRetry(attempt, maxAttempts, error, delayMs)

      // Wait before retrying
      await this.sleep(delayMs)

      // Recursively attempt again
      return this.attemptGenerateContent(request, attempt + 1, maxAttempts)
    }
  }

  /**
   * Attempt to generate content stream with retry logic.
   *
   * @yields Content chunks as they are generated
   */
  private async *attemptGenerateContentStream(
    request: GenerateContentRequest,
    attempt: number,
    maxAttempts: number,
  ): AsyncGenerator<GenerateContentChunk> {
    try {
      // Yield all chunks from the inner generator
      for await (const chunk of this.inner.generateContentStream(request)) {
        yield chunk
      }
    } catch (error) {
      // Check if this is the last attempt
      if (attempt >= maxAttempts) {
        this.emitExhausted(attempt, error)
        throw error
      }

      // Check if error is retryable
      if (!isRetryableError(error, this.policy)) {
        throw error
      }

      // Calculate delay and emit retry event
      const delayMs = calculateRetryDelay(attempt, this.policy)
      this.emitRetry(attempt, maxAttempts, error, delayMs)

      // Wait before retrying
      await this.sleep(delayMs)

      // Recursively attempt again
      yield* this.attemptGenerateContentStream(request, attempt + 1, maxAttempts)
    }
  }

  /**
   * Emit an exhausted event when all retries are used.
   */
  private emitExhausted(attempts: number, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error)

    console.error(`[Retry] All ${attempts} attempts exhausted. Final error: ${errorMessage}`)

    this.eventBus?.emit('llmservice:error', {
      error: `All ${attempts} retry attempts exhausted: ${errorMessage}`,
    })
  }

  /**
   * Emit a retry event via warning.
   */
  private emitRetry(attempt: number, maxAttempts: number, error: unknown, delayMs: number): void {
    const errorMessage = error instanceof Error ? error.message : String(error)

    console.warn(
      `[Retry] Attempt ${attempt}/${maxAttempts} failed: ${errorMessage}. ` +
        `Retrying in ${delayMs}ms...`,
    )

    this.eventBus?.emit('llmservice:warning', {
      message: `Retry attempt ${attempt}/${maxAttempts} after ${delayMs}ms: ${errorMessage}`,
    })
  }

  /**
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve()
      }, ms)
    })
  }
}
