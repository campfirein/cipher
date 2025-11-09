import type {IMessageFormatter} from '../../../core/interfaces/i-message-formatter.js'
import type {ITokenizer} from '../../../core/interfaces/i-tokenizer.js'
import type {InternalMessage} from '../../../core/interfaces/message-types.js'

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
  private readonly formatter: IMessageFormatter<T>
  private readonly maxInputTokens: number
  private messages: InternalMessage[] = []
  private readonly sessionId: string
  private readonly tokenizer: ITokenizer

  /**
   * Creates a new context manager
   *
   * @param sessionId - Unique session identifier
   * @param formatter - Message formatter for provider-specific format
   * @param tokenizer - Token counter for the model
   * @param maxInputTokens - Maximum input tokens allowed
   */
  public constructor(
    sessionId: string,
    formatter: IMessageFormatter<T>,
    tokenizer: ITokenizer,
    maxInputTokens: number,
  ) {
    this.sessionId = sessionId
    this.formatter = formatter
    this.tokenizer = tokenizer
    this.maxInputTokens = maxInputTokens
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
  }

  /**
   * Clear all messages from the conversation history.
   */
  public clearHistory(): void {
    this.messages = []
  }

  /**
   * Get formatted messages with compression applied.
   *
   * @returns Formatted messages, system prompt, and token count
   */
  public async getFormattedMessagesWithCompression(): Promise<FormattedMessagesResult<T>> {
    // For now, no compression - just format messages
    // Compression logic can be added later when needed

    const formattedMessages = this.formatter.format(this.messages)

    // Count tokens (simplified - count on formatted messages)
    const tokensUsed = await this.countTokens(formattedMessages)

    return {
      formattedMessages,
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
