/**
 * Message role in a conversation.
 */
export type MessageRole = 'assistant' | 'system' | 'tool' | 'user'

/**
 * Tool call structure.
 * Represents a request from the LLM to execute a tool.
 */
export interface ToolCall {
  /** Arguments to pass to the tool */
  arguments: Record<string, unknown>

  /** Unique identifier for this tool call */
  id: string

  /** Name of the tool to execute */
  name: string
}

/**
 * Message in a conversation.
 * Represents a single message in the conversation history.
 */
export interface Message {
  /** Message content */
  content: string

  /** Message role (who sent the message) */
  role: MessageRole

  /** Optional timestamp (milliseconds since epoch) */
  timestamp?: number

  /** Tool call ID (for tool result messages) */
  toolCallId?: string

  /** Tool calls requested by the assistant */
  toolCalls?: ToolCall[]

  /** Tool name (for tool result messages) */
  toolName?: string
}

/**
 * Session configuration.
 * Options for customizing session behavior.
 */
export interface SessionConfig {
  /** Maximum number of tool execution iterations (default: 10) */
  maxToolIterations?: number

  /** Optional system prompt to prepend to conversation */
  systemPrompt?: string
}

/**
 * LLM response structure.
 * Response from the LLM service.
 */
export interface LLMResponse {
  /** Response content */
  content: string

  /** Optional tool calls requested by the LLM */
  toolCalls?: ToolCall[]
}