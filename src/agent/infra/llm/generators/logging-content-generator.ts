/**
 * Logging Content Generator Decorator.
 *
 * Wraps any IContentGenerator to add debug logging capabilities.
 * Logs request/response metadata, timing, and errors.
 */

import type {
  GenerateContentChunk,
  GenerateContentRequest,
  GenerateContentResponse,
  IContentGenerator,
} from '../../../core/interfaces/i-content-generator.js'
import type {SessionEventBus} from '../../events/event-emitter.js'

/**
 * Logging options for the decorator.
 */
export interface LoggingOptions {
  /** Log individual streaming chunks */
  logChunks?: boolean
  /** Log request details */
  logRequests?: boolean
  /** Log response details */
  logResponses?: boolean
  /** Enable verbose logging (all options) */
  verbose?: boolean
}

/**
 * Logging Content Generator.
 *
 * Decorator that wraps any IContentGenerator to add logging capabilities.
 * Useful for debugging, monitoring, and performance analysis.
 *
 * Features:
 * - Request/response logging with configurable verbosity
 * - Timing information for all operations
 * - Error logging with context
 * - Event emission via SessionEventBus
 */
export class LoggingContentGenerator implements IContentGenerator {
  private readonly eventBus?: SessionEventBus
  private readonly inner: IContentGenerator
  private readonly options: LoggingOptions

  /**
   * Create a new Logging Content Generator.
   *
   * @param inner - The wrapped content generator
   * @param eventBus - Optional event bus for emitting events
   * @param options - Logging options
   */
  constructor(
    inner: IContentGenerator,
    eventBus?: SessionEventBus,
    options: LoggingOptions = {},
  ) {
    this.inner = inner
    this.eventBus = eventBus
    this.options = options
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
   * Generate content with logging.
   *
   * @param request - Generation request
   * @returns Generated content response
   */
  public async generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse> {
    const startTime = Date.now()
    const requestId = this.generateRequestId()

    this.logRequest(requestId, request)
    this.eventBus?.emit('llmservice:thinking')

    try {
      const response = await this.inner.generateContent(request)
      this.emitUsageEvent(request, response, Date.now() - startTime)
      return response
    } catch (error) {
      this.logError(requestId, error, Date.now() - startTime)
      throw error
    }
  }

  /**
   * Generate content with streaming and logging.
   *
   * @param request - Generation request
   * @yields Content chunks as they are generated
   * @returns Async generator yielding content chunks
   */
  public async *generateContentStream(
    request: GenerateContentRequest,
  ): AsyncGenerator<GenerateContentChunk> {
    const startTime = Date.now()
    const requestId = this.generateRequestId()

    this.logRequest(requestId, request)
    this.eventBus?.emit('llmservice:thinking')

    let capturedUsage: GenerateContentChunk['usage']
    try {
      let chunkCount = 0

      for await (const chunk of this.inner.generateContentStream(request)) {
        chunkCount++

        if (this.shouldLogChunks()) {
          this.logChunk(requestId, chunk, chunkCount)
        }

        // Capture usage when present (typically only on the final chunk).
        // Last write wins — multiple chunks may carry usage in some providers.
        if (chunk.usage) {
          capturedUsage = chunk.usage
        }

        yield chunk
      }

      if (capturedUsage) {
        this.emitUsageEventFromChunk(request, capturedUsage, Date.now() - startTime)
      }
    } catch (error) {
      this.logError(requestId, error, Date.now() - startTime)
      throw error
    }
  }

  /**
   * Emit `llmservice:usage` with the provider-reported token counts and
   * the wall-clock duration. No-ops if either the response carries no usage
   * (the provider didn't report any) or no event bus is wired.
   *
   * Caller is `generateContent` (non-streaming). Streaming variant has its
   * own gap documented above.
   */
  private emitUsageEvent(
    request: GenerateContentRequest,
    response: GenerateContentResponse,
    durationMs: number,
  ): void {
    if (!this.eventBus || !response.usage) return
    this.emitUsageEventFromChunk(request, response.usage, durationMs)
  }

  /**
   * Shared emit helper — used by both non-streaming (response.usage) and
   * streaming (final chunk.usage) paths.
   */
  private emitUsageEventFromChunk(
    request: GenerateContentRequest,
    usage: NonNullable<GenerateContentResponse['usage']>,
    durationMs: number,
  ): void {
    if (!this.eventBus) return
    this.eventBus.emit('llmservice:usage', {
      durationMs,
      inputTokens: usage.inputTokens,
      model: request.model,
      outputTokens: usage.outputTokens,
      taskId: request.taskId,
      timestamp: Date.now(),
      totalTokens: usage.totalTokens,
      ...(usage.cacheReadTokens !== undefined && {cacheReadTokens: usage.cacheReadTokens}),
      ...(usage.cacheCreationTokens !== undefined && {cacheCreationTokens: usage.cacheCreationTokens}),
      ...(usage.reasoningTokens !== undefined && {reasoningTokens: usage.reasoningTokens}),
    })
  }

  /**
   * Generate a unique request ID for tracking.
   */
  private generateRequestId(): string {
    return Math.random().toString(36).slice(2, 8)
  }

  /**
   * Log a streaming chunk (no-op: verbose-only, routed through event bus).
   */
  private logChunk(_requestId: string, _chunk: GenerateContentChunk, _index: number): void {
    // Removed: console.debug output disrupts Ink TUI layout.
    // Chunk-level telemetry is available via event bus if needed.
  }

  /**
   * Log an error that occurred during generation.
   */
  private logError(_requestId: string, error: unknown, _durationMs: number): void {
    const errorMessage = error instanceof Error ? error.message : String(error)

    this.eventBus?.emit('llmservice:error', {
      error: errorMessage,
    })
  }

  /**
   * Log a generation request (no-op: verbose-only, routed through event bus).
   */
  private logRequest(_requestId: string, _request: GenerateContentRequest): void {
    // Removed: console.debug output disrupts Ink TUI layout.
    // Request metadata is available via event bus if needed.
  }

  /**
   * Check if chunks should be logged.
   */
  private shouldLogChunks(): boolean {
    return this.options.logChunks === true || this.options.verbose === true
  }
}
