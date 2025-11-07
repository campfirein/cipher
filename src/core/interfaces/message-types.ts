/**
 * Internal representation of messages in a conversation.
 * Standardizes message format across different LLM providers.
 */

/**
 * Text content part
 */
export interface TextPart {
  text: string
  type: 'text'
}

/**
 * Image content part
 */
export interface ImagePart {
  image: ArrayBuffer | Buffer | string | Uint8Array | URL
  mimeType?: string
  type: 'image'
}

/**
 * File content part
 */
export interface FilePart {
  data: ArrayBuffer | Buffer | string | Uint8Array | URL
  filename?: string
  mimeType: string
  type: 'file'
}

/**
 * Union type for message content parts
 */
export type MessagePart = FilePart | ImagePart | TextPart

/**
 * Tool call made by the assistant
 */
export interface ToolCall {
  /**
   * Function call details
   */
  function: {
    /**
     * Arguments for the function in JSON string format
     */
    arguments: string

    /**
     * Name of the function to call
     */
    name: string
  }

  /**
   * Unique identifier for this tool call
   */
  id: string

  /**
   * The type of tool call (currently only 'function' is supported)
   */
  type: 'function'
}

/**
 * Internal message representation used across all LLM providers.
 * This standardized format is converted to/from provider-specific formats by formatters.
 */
export interface InternalMessage {
  /**
   * The content of the message.
   * - String for system, assistant (text only), and tool messages.
   * - Array of parts for user messages (can include text, images, and files).
   * - null if an assistant message only contains tool calls.
   */
  content: Array<MessagePart> | null | string

  /**
   * Name of the tool that produced this result.
   * Only present in tool messages.
   */
  name?: string

  /**
   * The role of the entity sending the message.
   * - 'system': System instructions or context
   * - 'user': End-user input
   * - 'assistant': LLM response
   * - 'tool': Result from a tool execution
   */
  role: 'assistant' | 'system' | 'tool' | 'user'

  /**
   * ID of the tool call this message is responding to.
   * Only present in tool messages.
   */
  toolCallId?: string

  /**
   * Tool calls made by the assistant.
   * Only present in assistant messages when the LLM requests tool execution.
   */
  toolCalls?: ToolCall[]
}