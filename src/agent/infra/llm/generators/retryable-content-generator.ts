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
  extractRateLimitDelay,
  isRetryableError,
  RATE_LIMIT_FALLBACK_DELAY_MS,
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
    return this.attemptGenerateContent(request, 1, 0)
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
    yield* this.attemptGenerateContentStream(request, 1, 0)
  }

  /**
   * Attempt to generate content with retry logic.
   *
   * @param attempt - 1-based attempt number for the current call
   * @param rateLimitAttempts - Count of attempts that hit a 429 so far (used
   *   to enforce policy.maxRetriesOnRateLimit independently of policy.maxRetries)
   */
  private async attemptGenerateContent(
    request: GenerateContentRequest,
    attempt: number,
    rateLimitAttempts: number,
  ): Promise<GenerateContentResponse> {
    try {
      return await this.inner.generateContent(request)
    } catch (error) {
      const isRateLimit = this.isRateLimitError(error)
      const decision = this.shouldRetry(error, attempt, rateLimitAttempts, isRateLimit)
      if (decision.kind === 'stop') {
        if (decision.exhausted) this.emitExhausted(attempt, error, isRateLimit)
        throw error
      }

      const delayMs = isRateLimit
        ? (extractRateLimitDelay(error) ?? RATE_LIMIT_FALLBACK_DELAY_MS)
        : calculateRetryDelay(attempt, this.policy)
      this.emitRetry(attempt, decision.maxAttempts, error, delayMs, isRateLimit)

      await this.sleep(delayMs)

      return this.attemptGenerateContent(
        request,
        attempt + 1,
        rateLimitAttempts + (isRateLimit ? 1 : 0),
      )
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
    rateLimitAttempts: number,
  ): AsyncGenerator<GenerateContentChunk> {
    try {
      for await (const chunk of this.inner.generateContentStream(request)) {
        yield chunk
      }
    } catch (error) {
      const isRateLimit = this.isRateLimitError(error)
      const decision = this.shouldRetry(error, attempt, rateLimitAttempts, isRateLimit)
      if (decision.kind === 'stop') {
        if (decision.exhausted) this.emitExhausted(attempt, error, isRateLimit)
        throw error
      }

      const delayMs = isRateLimit
        ? (extractRateLimitDelay(error) ?? RATE_LIMIT_FALLBACK_DELAY_MS)
        : calculateRetryDelay(attempt, this.policy)
      this.emitRetry(attempt, decision.maxAttempts, error, delayMs, isRateLimit)

      await this.sleep(delayMs)

      yield* this.attemptGenerateContentStream(
        request,
        attempt + 1,
        rateLimitAttempts + (isRateLimit ? 1 : 0),
      )
    }
  }

  /**
   * Emit an exhausted event when all retries are used. Rate-limit
   * exhaustion is tagged so observability can distinguish it from generic
   * transient-error exhaustion.
   */
  private emitExhausted(attempts: number, error: unknown, isRateLimit: boolean): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const tag = isRateLimit ? '[RATE_LIMIT_EXHAUSTED] ' : ''

    this.eventBus?.emit('llmservice:error', {
      error: `${tag}All ${attempts} retry attempts exhausted: ${errorMessage}`,
    })
  }

  /**
   * Emit a retry event via warning. Rate-limit retries are tagged so they
   * surface clearly in stdout traces and observability tooling — the
   * silent-retry-loop hangs we hit on Anthropic were invisible before this.
   */
  private emitRetry(
    attempt: number,
    maxAttempts: number,
    error: unknown,
    delayMs: number,
    isRateLimit: boolean,
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const tag = isRateLimit ? '[RATE_LIMIT] ' : ''

    this.eventBus?.emit('llmservice:warning', {
      message: `${tag}Retry attempt ${attempt}/${maxAttempts} after ${delayMs}ms: ${errorMessage}`,
    })
  }

  /**
   * Return true when the error is a rate-limit (HTTP 429) response.
   *
   * Checks both the numeric status code (most reliable) and the error
   * message text as a fallback for providers that surface 429s differently.
   */
  private isRateLimitError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const e = error as Record<string, unknown>
    const status = e.status ?? e.statusCode
    if (status === 429) return true
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
    return msg.includes('rate limit') || msg.includes('rate_limit')
  }

  /**
   * Decide whether to retry given the error class, attempt number, and
   * accumulated rate-limit attempts.
   *
   * Rate-limit errors are capped separately by `policy.maxRetriesOnRateLimit`
   * so a persistent 429 storm doesn't burn the full `policy.maxRetries`
   * budget at ~65s per attempt.
   */
  private shouldRetry(
    error: unknown,
    attempt: number,
    rateLimitAttempts: number,
    isRateLimit: boolean,
  ): {exhausted: boolean; kind: 'stop'} | {kind: 'retry'; maxAttempts: number} {
    const maxAttempts = isRateLimit
      ? this.policy.maxRetriesOnRateLimit + 1
      : this.policy.maxRetries + 1

    const usedRateLimitBudget = isRateLimit && rateLimitAttempts >= this.policy.maxRetriesOnRateLimit
    const usedAttemptBudget = attempt >= maxAttempts

    if (usedRateLimitBudget || usedAttemptBudget) {
      return {exhausted: true, kind: 'stop'}
    }

    if (!isRetryableError(error, this.policy)) {
      return {exhausted: false, kind: 'stop'}
    }

    return {kind: 'retry', maxAttempts}
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
