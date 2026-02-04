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

    try {
      let chunkCount = 0

      for await (const chunk of this.inner.generateContentStream(request)) {
        chunkCount++

        if (this.shouldLogChunks()) {
          this.logChunk(requestId, chunk, chunkCount)
        }

        yield chunk
      }
    } catch (error) {
      this.logError(requestId, error, Date.now() - startTime)
      throw error
    }
  }

  /**
   * Generate a unique request ID for tracking.
   */
  private generateRequestId(): string {
    return Math.random().toString(36).slice(2, 8)
  }

  /**
   * Log a streaming chunk.
   */
  private logChunk(requestId: string, chunk: GenerateContentChunk, index: number): void {
    console.debug(`[LLM:${requestId}] Chunk #${index}`, {
      contentLength: chunk.content?.length ?? 0,
      finishReason: chunk.finishReason,
      hasToolCalls: Boolean(chunk.toolCalls?.length),
      isComplete: chunk.isComplete,
    })
  }

  /**
   * Log an error that occurred during generation.
   */
  private logError(requestId: string, error: unknown, durationMs: number): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[LLM:${requestId}] Error after ${durationMs}ms:`, errorMessage)

    this.eventBus?.emit('llmservice:error', {
      error: errorMessage,
    })
  }

  /**
   * Log a generation request.
   */
  private logRequest(requestId: string, request: GenerateContentRequest): void {
    if (!this.shouldLogRequests()) {
      return
    }

    console.debug(`[LLM:${requestId}] Request`, {
      hasSystemPrompt: Boolean(request.systemPrompt),
      hasTools: Boolean(request.tools && Object.keys(request.tools).length > 0),
      maxTokens: request.config.maxTokens,
      messageCount: request.contents.length,
      model: request.model,
      temperature: request.config.temperature,
      toolCount: request.tools ? Object.keys(request.tools).length : 0,
    })
  }

  /**
   * Check if chunks should be logged.
   */
  private shouldLogChunks(): boolean {
    return this.options.logChunks === true || this.options.verbose === true
  }

  /**
   * Check if requests should be logged.
   */
  private shouldLogRequests(): boolean {
    return this.options.logRequests === true || this.options.verbose === true
  }
}
