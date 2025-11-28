import type {IHistoryStorage} from '../../../../core/interfaces/cipher/i-history-storage.js'
import type {ILogger} from '../../../../core/interfaces/cipher/i-logger.js'
import type {IMessageFormatter} from '../../../../core/interfaces/cipher/i-message-formatter.js'
import type {ITokenizer} from '../../../../core/interfaces/cipher/i-tokenizer.js'
import type {InternalMessage} from '../../../../core/interfaces/cipher/message-types.js'
import type {ICompressionStrategy} from './compression/types.js'

import {NoOpLogger} from '../../../../core/interfaces/cipher/i-logger.js'
import {getErrorMessage} from '../../../../utils/error-helpers.js'
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
  /** Number of messages filtered out as invalid */
  messagesFiltered: number
  systemPrompt?: string
  tokensUsed: number
}

/**
 * Reason why a message was considered invalid for API inclusion.
 */
export type MessageInvalidReason = 'empty_content' | 'incomplete_tool_call' | 'system_noise'

/**
 * Result of message validation check.
 */
export interface MessageValidation {
  /** Whether the message is valid for API inclusion */
  isValid: boolean
  /** Reason if invalid */
  reason?: MessageInvalidReason
}

/**
 * Configuration options for ContextManager
 */
export interface ContextManagerOptions<T> {
  compressionStrategies?: ICompressionStrategy[]
  formatter: IMessageFormatter<T>
  historyStorage?: IHistoryStorage
  logger?: ILogger
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
  private readonly logger: ILogger
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
    this.logger = options.logger ?? new NoOpLogger()

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
      this.logger.error('Failed to persist history after assistant message', {error, sessionId: this.sessionId})
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
      this.logger.error('Failed to persist history after system message', {error, sessionId: this.sessionId})
    })
  }

  /**
   * Add a tool result message to the conversation.
   *
   * @param toolCallId - ID of the tool call this result responds to
   * @param toolName - Name of the tool that was executed
   * @param result - Result from tool execution
   * @param _metadata - Additional metadata (success status, error type, execution metadata)
   * @param _metadata.success - Whether the tool execution succeeded
   * @param _metadata.errorType - Classified error type (if failed)
   * @param _metadata.metadata - Execution metadata (duration, tokens, etc.)
   * @returns The content that was added
   */
  public async addToolResult(
    toolCallId: string,
    toolName: string,
    result: unknown,
    _metadata: {errorType?: string; metadata?: Record<string, unknown>; success: boolean},
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
      this.logger.error('Failed to persist history after tool result', {error, sessionId: this.sessionId})
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
  public async addUserMessage(content: string, _imageData?: ImageData, _fileData?: FileData): Promise<void> {
    // Simple implementation: just use text content
    // Image and file support can be added later
    const message: InternalMessage = {
      content,
      role: 'user',
    }

    this.messages.push(message)

    // Auto-save to persistent storage (non-blocking)
    this.persistHistory().catch((error: Error) => {
      this.logger.error('Failed to persist history after user message', {error, sessionId: this.sessionId})
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
        // Debug logging removed for cleaner user experience
      } catch (error) {
        this.logger.error('Failed to clear persisted history', {error, sessionId: this.sessionId})
      }
    }
  }

  /**
   * Get comprehensive messages (all messages, for persistence/debugging).
   * This includes all messages including invalid ones.
   *
   * @returns All messages in the conversation history
   */
  public getComprehensiveMessages(): InternalMessage[] {
    return [...this.messages]
  }

  /**
   * Get curated messages (valid messages only, for API calls).
   * Filters out invalid messages that would waste tokens or confuse the LLM.
   *
   * @returns Only valid messages suitable for API calls
   */
  public getCuratedMessages(): InternalMessage[] {
    return this.messages.filter((msg) => this.validateMessage(msg).isValid)
  }

  /**
   * Get formatted messages with compression applied.
   * Uses curated (valid-only) messages for better LLM context quality.
   *
   * @param systemPrompt - Optional system prompt (for token accounting)
   * @returns Formatted messages, system prompt, token count, and filter stats
   */
  public async getFormattedMessagesWithCompression(systemPrompt?: string): Promise<FormattedMessagesResult<T>> {
    // Get curated messages (filter invalid ones)
    const curatedMessages = this.getCuratedMessages()
    const messagesFiltered = this.messages.length - curatedMessages.length

    // Calculate system prompt tokens
    const systemPromptTokens = systemPrompt ? this.tokenizer.countTokens(systemPrompt) : 0

    // Compress curated history if needed
    const compressedHistory = await this.compressHistoryIfNeeded(systemPromptTokens, curatedMessages)

    // Format compressed messages
    const formattedMessages = this.formatter.format(compressedHistory)

    // Count total tokens (system + history)
    const historyTokens = countMessagesTokens(compressedHistory, this.tokenizer)
    const tokensUsed = systemPromptTokens + historyTokens

    return {
      formattedMessages,
      messagesFiltered,
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
      this.logger.warn('ContextManager already initialized', {sessionId: this.sessionId})
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
        // Debug logging removed for cleaner user experience
        return true
      }

      this.isInitialized = true
      // Debug logging removed for cleaner user experience
      return false
    } catch (error) {
      this.logger.error('Failed to load history for session', {error, sessionId: this.sessionId})
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
   * @param messagesToCompress - Messages to compress (defaults to all messages)
   * @returns Compressed message history
   */
  private async compressHistoryIfNeeded(
    systemPromptTokens: number,
    messagesToCompress?: InternalMessage[],
  ): Promise<InternalMessage[]> {
    const messages = messagesToCompress ?? this.messages

    // Calculate current token usage
    const currentHistoryTokens = countMessagesTokens(messages, this.tokenizer)
    const totalTokens = systemPromptTokens + currentHistoryTokens

    // No compression needed
    if (totalTokens <= this.maxInputTokens) {
      // Debug logging removed for cleaner user experience
      return messages
    }

    // Debug logging removed for cleaner user experience

    // Calculate target token budget for history
    // Reserve space for system prompt
    const maxHistoryTokens = this.maxInputTokens - systemPromptTokens

    // Apply compression strategies sequentially
    let compressedHistory = messages
    for (const strategy of this.compressionStrategies) {
      // Debug logging removed for cleaner user experience

      // eslint-disable-next-line no-await-in-loop
      compressedHistory = await strategy.compress(compressedHistory, maxHistoryTokens, this.tokenizer)

      // Check if we've met the token limit
      const compressedTokens = countMessagesTokens(compressedHistory, this.tokenizer)
      const newTotal = systemPromptTokens + compressedTokens

      if (newTotal <= this.maxInputTokens) {
        // Debug logging removed for cleaner user experience
        break
      }
    }

    // Final token count
    const finalTokens = countMessagesTokens(compressedHistory, this.tokenizer)
    const finalTotal = systemPromptTokens + finalTokens

    if (finalTotal > this.maxInputTokens) {
      // Keep warning as it's important for users to know
      this.logger.warn('Unable to compress below token limit', {
        finalTokens,
        finalTotal,
        maxInputTokens: this.maxInputTokens,
        sessionId: this.sessionId,
        systemPromptTokens,
      })
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
   * Check if a system message is noise (empty or whitespace only).
   *
   * @param message - Message to check
   * @returns True if the message is noise
   */
  private isSystemNoise(message: InternalMessage): boolean {
    const content = typeof message.content === 'string' ? message.content : ''
    return content.trim().length === 0
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
      return `[Tool result serialization failed: ${getErrorMessage(error)}]`
    }
  }

  /**
   * Validate a message for API inclusion.
   * Filters out invalid messages that would waste tokens or confuse the LLM.
   *
   * Rules:
   * 1. Empty content (non-tool messages without content or tool calls)
   * 2. Tool result without corresponding tool call ID
   * 3. System messages with only noise (empty or whitespace)
   *
   * @param message - Message to validate
   * @returns Validation result indicating if message is valid for API
   */
  private validateMessage(message: InternalMessage): MessageValidation {
    // Rule 1: Empty content check (skip for tool messages which always have content)
    if (message.role !== 'tool' && !message.content && (!message.toolCalls || message.toolCalls.length === 0)) {
      return {isValid: false, reason: 'empty_content'}
    }

    // Rule 2: Tool result without corresponding call ID
    if (message.role === 'tool' && !message.toolCallId) {
      return {isValid: false, reason: 'incomplete_tool_call'}
    }

    // Rule 3: System messages with only noise (empty or whitespace)
    if (message.role === 'system' && this.isSystemNoise(message)) {
      return {isValid: false, reason: 'system_noise'}
    }

    return {isValid: true}
  }
}
