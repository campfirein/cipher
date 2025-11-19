import type {IHistoryStorage} from '../../../../core/interfaces/cipher/i-history-storage.js'
import type {IMessageFormatter} from '../../../../core/interfaces/cipher/i-message-formatter.js'
import type {ITokenizer} from '../../../../core/interfaces/cipher/i-tokenizer.js'
import type {InternalMessage} from '../../../../core/interfaces/cipher/message-types.js'
import type {ICompressionStrategy} from './compression/types.js'

import {MiddleRemovalStrategy, OldestRemovalStrategy} from './compression/index.js'
import {countMessagesTokens} from './utils.js'

/**
 * Image data for messages
 */
export interface ImageData {
  data: ArrayBuffer | Buffer | string | Uint8Array | URL
  mimeType?: string
}

/**
 * File data for messages
 */
export interface FileData {
  data: ArrayBuffer | Buffer | string | Uint8Array | URL
  filename?: string
  mimeType: string
}

/**
 * Result of message formatting with compression
 */
export interface FormattedMessagesResult<T> {
  formattedMessages: T[]
  systemPrompt?: string
  tokensUsed: number
}

/**
 * Configuration options for ContextManager
 */
export interface ContextManagerOptions<T> {
  compressionStrategies?: ICompressionStrategy[]
  formatter: IMessageFormatter<T>
  historyStorage?: IHistoryStorage
  maxInputTokens: number
  sessionId: string
  tokenizer: ITokenizer
}

/**
 * Context Manager for managing conversation history.
 *
 * Responsibilities:
 * - Store and manage internal message history
 * - Format messages for specific LLM providers
 * - Handle message compression (future)
 * - Count tokens for context management
 *
 * Generic type T represents the provider-specific message format
 * (e.g., GeminiContent for Gemini, MessageParam for Anthropic)
 */
export class ContextManager<T> {
  private readonly compressionStrategies: ICompressionStrategy[]
  private readonly formatter: IMessageFormatter<T>
  private readonly historyStorage?: IHistoryStorage
  private isInitialized: boolean = false
  private readonly maxInputTokens: number
  private messages: InternalMessage[] = []
  private readonly sessionId: string
  private readonly tokenizer: ITokenizer

  /**
   * Creates a new context manager
   *
   * @param options - Configuration options
   * @param options.sessionId - Unique session identifier
   * @param options.formatter - Message formatter for provider-specific format
   * @param options.tokenizer - Token counter for the model
   * @param options.maxInputTokens - Maximum input tokens allowed
   * @param options.historyStorage - Optional history storage for persistence
   * @param options.compressionStrategies - Optional compression strategies (defaults to MiddleRemoval + OldestRemoval)
   */
  public constructor(options: ContextManagerOptions<T>) {
    this.sessionId = options.sessionId
    this.formatter = options.formatter
    this.tokenizer = options.tokenizer
    this.maxInputTokens = options.maxInputTokens
    this.historyStorage = options.historyStorage

    // Initialize compression strategies with defaults
    this.compressionStrategies = options.compressionStrategies ?? [
      new MiddleRemovalStrategy({preserveEnd: 5, preserveStart: 4}),
      new OldestRemovalStrategy({minMessagesToKeep: 4}),
    ]
  }

  /**
   * Add an assistant message to the conversation.
   *
   * @param content - Message content (text or null if only tool calls)
   * @param toolCalls - Optional tool calls made by the assistant
   */
  public async addAssistantMessage(content: null | string, toolCalls?: InternalMessage['toolCalls']): Promise<void> {
    const message: InternalMessage = {
      content,
      role: 'assistant',
      toolCalls,
    }

    this.messages.push(message)

    // Auto-save to persistent storage (non-blocking)
    this.persistHistory().catch((error: Error) => {
      console.error(`[ContextManager] Failed to persist history after assistant message:`, error)
    })
  }

  /**
   * Add a system message to the conversation.
   *
   * @param content - System message content
   */
  public async addSystemMessage(content: string): Promise<void> {
    const message: InternalMessage = {
      content,
      role: 'system',
    }

    this.messages.push(message)

    // Auto-save to persistent storage (non-blocking)
    this.persistHistory().catch((error: Error) => {
      console.error(`[ContextManager] Failed to persist history after system message:`, error)
    })
  }

  /**
   * Add a tool result message to the conversation.
   *
   * @param toolCallId - ID of the tool call this result responds to
   * @param toolName - Name of the tool that was executed
   * @param result - Result from tool execution
   * @param _metadata - Additional metadata with success status (currently unused)
   * @param _metadata.success - Whether the tool execution succeeded
   * @returns The content that was added
   */
  public async addToolResult(
    toolCallId: string,
    toolName: string,
    result: unknown,
    _metadata: {success: boolean},
  ): Promise<string> {
    // Sanitize result - convert to string representation
    const sanitized = this.sanitizeToolResult(result)

    const message: InternalMessage = {
      content: sanitized,
      name: toolName,
      role: 'tool',
      toolCallId,
    }

    this.messages.push(message)

    // Auto-save to persistent storage (non-blocking)
    this.persistHistory().catch((error: Error) => {
      console.error(`[ContextManager] Failed to persist history after tool result:`, error)
    })

    return sanitized
  }

  /**
   * Add a user message to the conversation.
   *
   * @param content - User message text
   * @param _imageData - Optional image data (not yet implemented)
   * @param _fileData - Optional file data (not yet implemented)
   */
  public async addUserMessage(
    content: string,
    _imageData?: ImageData,
    _fileData?: FileData,
  ): Promise<void> {
    // Simple implementation: just use text content
    // Image and file support can be added later
    const message: InternalMessage = {
      content,
      role: 'user',
    }

    this.messages.push(message)

    // Auto-save to persistent storage (non-blocking)
    this.persistHistory().catch((error: Error) => {
      console.error(`[ContextManager] Failed to persist history after user message:`, error)
    })
  }

  /**
   * Clear all messages from the conversation history.
   * Also clears persisted history if storage is enabled.
   */
  public async clearHistory(): Promise<void> {
    this.messages = []

    // Clear persisted history if storage enabled
    if (this.historyStorage) {
      try {
        await this.historyStorage.deleteHistory(this.sessionId)
        console.log(`[ContextManager] Cleared persisted history for session ${this.sessionId}`)
      } catch (error) {
        console.error(`[ContextManager] Failed to clear persisted history:`, error)
      }
    }
  }

  /**
   * Get formatted messages with compression applied.
   *
   * @param systemPrompt - Optional system prompt (for token accounting)
   * @returns Formatted messages, system prompt, and token count
   */
  public async getFormattedMessagesWithCompression(
    systemPrompt?: string
  ): Promise<FormattedMessagesResult<T>> {
    // Calculate system prompt tokens
    const systemPromptTokens = systemPrompt ? this.tokenizer.countTokens(systemPrompt) : 0

    // Compress history if needed
    const compressedHistory = await this.compressHistoryIfNeeded(systemPromptTokens)

    // Format compressed messages - PASS systemPrompt to formatter
    const formattedMessages = this.formatter.format(compressedHistory, systemPrompt)

    // Count total tokens (system + history)
    const historyTokens = countMessagesTokens(compressedHistory, this.tokenizer)
    const tokensUsed = systemPromptTokens + historyTokens

    return {
      formattedMessages,
      systemPrompt,
      tokensUsed,
    }
  }

  /**
   * Get the maximum input tokens allowed.
   */
  public getMaxInputTokens(): number {
    return this.maxInputTokens
  }

  /**
   * Get all messages in the conversation.
   */
  public getMessages(): InternalMessage[] {
    return [...this.messages]
  }

  /**
   * Get the session ID.
   */
  public getSessionId(): string {
    return this.sessionId
  }

  /**
   * Initialize the context manager by loading persisted history.
   * Should be called after construction to restore previous conversation.
   *
   * @returns True if history was loaded, false otherwise
   */
  public async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      console.warn(`[ContextManager] Already initialized for session ${this.sessionId}`)
      return false
    }

    if (!this.historyStorage) {
      this.isInitialized = true
      return false
    }

    try {
      const history = await this.historyStorage.loadHistory(this.sessionId)

      if (history && history.length > 0) {
        this.messages = history
        this.isInitialized = true
        console.log(`[ContextManager] Loaded ${history.length} messages for session ${this.sessionId}`)
        return true
      }

      this.isInitialized = true
      console.log(`[ContextManager] No persisted history found for session ${this.sessionId}`)
      return false
    } catch (error) {
      console.error(`[ContextManager] Failed to load history for session ${this.sessionId}:`, error)
      this.isInitialized = true
      return false
    }
  }

  /**
   * Compress conversation history if needed to fit within token limits.
   *
   * This method applies compression strategies sequentially until the history
   * fits within the available token budget (maxInputTokens - systemPromptTokens).
   *
   * @param systemPromptTokens - Tokens used by system prompt (reserved, not compressible)
   * @returns Compressed message history
   */
  private async compressHistoryIfNeeded(systemPromptTokens: number): Promise<InternalMessage[]> {
    // Calculate current token usage
    const currentHistoryTokens = countMessagesTokens(this.messages, this.tokenizer)
    const totalTokens = systemPromptTokens + currentHistoryTokens

    // No compression needed
    if (totalTokens <= this.maxInputTokens) {
      console.log(`[ContextManager] ${totalTokens}/${this.maxInputTokens} tokens (sys: ${systemPromptTokens}, hist: ${currentHistoryTokens})`)
      return this.messages
    }

    console.log(`[ContextManager] Compressing: ${totalTokens}/${this.maxInputTokens} tokens (sys: ${systemPromptTokens}, hist: ${currentHistoryTokens})`)

    // Calculate target token budget for history
    // Reserve space for system prompt
    const maxHistoryTokens = this.maxInputTokens - systemPromptTokens

    // Apply compression strategies sequentially
    let compressedHistory = this.messages
    for (const strategy of this.compressionStrategies) {
      const strategyName = strategy.getName()
      console.log(`[ContextManager] Applying compression strategy: ${strategyName}`)

      // eslint-disable-next-line no-await-in-loop
      compressedHistory = await strategy.compress(
        compressedHistory,
        maxHistoryTokens,
        this.tokenizer
      )

      // Check if we've met the token limit
      const compressedTokens = countMessagesTokens(compressedHistory, this.tokenizer)
      const newTotal = systemPromptTokens + compressedTokens

      if (newTotal <= this.maxInputTokens) {
        console.log(
          `[ContextManager] Compression successful with ${strategyName}: ` +
          `${newTotal} / ${this.maxInputTokens} tokens ` +
          `(system: ${systemPromptTokens}, history: ${compressedTokens})`
        )
        break
      }
    }

    // Final token count
    const finalTokens = countMessagesTokens(compressedHistory, this.tokenizer)
    const finalTotal = systemPromptTokens + finalTokens

    if (finalTotal > this.maxInputTokens) {
      console.warn(
        `[ContextManager] Warning: Unable to compress below token limit. ` +
        `Final: ${finalTotal} / ${this.maxInputTokens} tokens ` +
        `(system: ${systemPromptTokens}, history: ${finalTokens})`
      )
    }

    return compressedHistory
  }

  /**
   * Count tokens in formatted messages.
   *
   * @param _formattedMessages - Messages in provider-specific format
   * @returns Token count
   */
  private async countTokens(_formattedMessages: T[]): Promise<number> {
    // Use tokenizer to count tokens
    // This is simplified - actual implementation would convert formatted messages back
    // For now, estimate based on internal messages
    const text = this.messages
      .map((m) => {
        if (typeof m.content === 'string') {
          return m.content
        }

        if (Array.isArray(m.content)) {
          return m.content
            .map((part) => {
              if (part.type === 'text') {
                return part.text
              }

              return ''
            })
            .join('')
        }

        return ''
      })
      .join('\n')

    return this.tokenizer.countTokens(text)
  }

  /**
   * Persist current conversation history to storage.
   * This is called automatically after each message is added.
   *
   * @returns Promise that resolves when history is persisted
   */
  private async persistHistory(): Promise<void> {
    if (!this.historyStorage) {
      return
    }

    // Store InternalMessage directly (no conversion needed)
    await this.historyStorage.saveHistory(this.sessionId, this.messages)
  }

  /**
   * Sanitize tool result for storage.
   * Handles large outputs, binary data, circular references, etc.
   *
   * @param result - Raw tool result
   * @returns Sanitized string representation
   */
  private sanitizeToolResult(result: unknown): string {
    try {
      // If already a string, return as-is
      if (typeof result === 'string') {
        return result
      }

      // Convert to JSON string
      const jsonString = JSON.stringify(result, null, 2)

      // Limit size to prevent extremely large results
      const MAX_RESULT_LENGTH = 50_000
      if (jsonString.length > MAX_RESULT_LENGTH) {
        return jsonString.slice(0, MAX_RESULT_LENGTH) + '\n... (truncated)'
      }

      return jsonString
    } catch (error) {
      // Handle circular references or other serialization errors
      return `[Tool result serialization failed: ${(error as Error).message}]`
    }
  }
}
