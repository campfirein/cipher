/**
 * Internal representation of messages in a conversation.
 * Standardizes message format across different LLM providers.
 *
 * Based on OpenCode's structured message parts pattern with:
 * - Discriminated union parts (text, image, file, reasoning, tool)
 * - Tool state machine (pending → running → completed/error)
 * - Part-level metadata (synthetic flag, cache control)
 * - Tool output attachments
 */

// ==================== BASE PART ====================

/**
 * Base interface for all message parts.
 * Provides common metadata fields for cache hints and synthetic content marking.
 */
export interface BasePart {
  /**
   * Part-level metadata for cache hints and custom data.
   * Used for Anthropic cache control and provider-specific features.
   */
  metadata?: {
    /** Custom metadata fields */
    [key: string]: unknown
    /** Anthropic cache control hint */
    cacheControl?: {type: 'ephemeral' | 'permanent'}
  }

  /**
   * Whether this is auto-generated content (e.g., "File saved", "Tool completed").
   * Synthetic parts can be filtered or styled differently in UI.
   */
  synthetic?: boolean
}

// ==================== CONTENT PARTS ====================

/**
 * Text content part
 */
export interface TextPart extends BasePart {
  text: string
  type: 'text'
}

/**
 * Image content part
 */
export interface ImagePart extends BasePart {
  image: ArrayBuffer | Buffer | string | Uint8Array | URL
  mimeType?: string
  type: 'image'
}

/**
 * File content part
 */
export interface FilePart extends BasePart {
  data: ArrayBuffer | Buffer | string | Uint8Array | URL
  filename?: string
  mimeType: string
  type: 'file'
}

/**
 * Reasoning/thinking content part.
 * Represents structured thinking traces from models like Gemini or Claude.
 */
export interface ReasoningPart extends BasePart {
  /**
   * Parsed summary for display in UI.
   * Extracted from the raw text for easier rendering.
   */
  summary?: {
    /** Detailed description of the thought */
    description: string
    /** Brief subject of the thought */
    subject: string
  }

  /** Raw reasoning/thinking text from the model */
  text: string

  type: 'reasoning'
}

// ==================== TOOL STATE MACHINE ====================

/**
 * Tool call in pending state (received from LLM, not yet started).
 */
export interface ToolStatePending {
  /** Parsed input arguments */
  input: Record<string, unknown>
  status: 'pending'
}

/**
 * Tool call in running state (execution started).
 */
export interface ToolStateRunning {
  /** Parsed input arguments */
  input: Record<string, unknown>
  /** Unix timestamp when execution started */
  startedAt: number
  status: 'running'
}

/**
 * Tool call in completed state (execution finished successfully).
 */
export interface ToolStateCompleted {
  /** Attachments produced by the tool (images, files) */
  attachments?: AttachmentPart[]
  /** Unix timestamp when this output was marked as compacted (for pruning) */
  compactedAt?: number
  /** Parsed input arguments */
  input: Record<string, unknown>
  /** Additional metadata about the execution */
  metadata?: Record<string, unknown>
  /** Tool output content */
  output: string
  status: 'completed'
  /** Execution timing */
  time: {end: number; start: number}
  /** Human-readable title for display */
  title?: string
}

/**
 * Tool call in error state (execution failed).
 */
export interface ToolStateError {
  /** Error message */
  error: string
  /** Parsed input arguments */
  input: Record<string, unknown>
  status: 'error'
  /** Execution timing (may have partial timing if failed mid-execution) */
  time: {end: number; start: number}
}

/**
 * Union of all tool states.
 */
export type ToolState = ToolStateCompleted | ToolStateError | ToolStatePending | ToolStateRunning

// ==================== ATTACHMENT PART ====================

/**
 * Attachment produced by a tool (image, file).
 * Used for MCP tools that return binary content.
 */
export interface AttachmentPart {
  /** Base64-encoded data or data URL */
  data: string
  /** Original filename if available */
  filename?: string
  /** MIME type of the attachment */
  mime: string
  type: 'file' | 'image'
}

// ==================== TOOL PART ====================

/**
 * Tool call part with state machine.
 * Tracks the full lifecycle of a tool call from pending to completed/error.
 *
 * This replaces the separate tool tracking in the execution queue,
 * integrating tool state directly into message parts for:
 * - Better conversation history representation
 * - Efficient compaction (can mark individual tool outputs as compacted)
 * - Rich UI feedback during execution
 */
export interface ToolPart extends BasePart {
  /** Unique identifier for this tool call */
  callId: string
  /** Current state of the tool call */
  state: ToolState
  /** Name of the tool being called */
  toolName: string
  type: 'tool'
}

// ==================== MESSAGE PART UNION ====================

/**
 * Union type for message content parts.
 * Discriminated by the `type` field.
 */
export type MessagePart = FilePart | ImagePart | ReasoningPart | TextPart | ToolPart

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
   * Message-level metadata for compression and tracking.
   * Used by compression strategies to mark summary messages and track compaction.
   */
  metadata?: {
    /** Custom metadata fields */
    [key: string]: unknown

    /**
     * Unix timestamp when this message was created via compaction.
     * Present on summary messages created by compression strategies.
     */
    compactedAt?: number

    /**
     * Whether this message is a summary of prior conversation.
     * When true, messages before this point can be filtered at read-time.
     */
    isSummary?: boolean

    /**
     * Number of messages that were summarized into this one.
     * Present when isSummary is true.
     */
    summarizedMessageCount?: number
  }

  /**
   * Name of the tool that produced this result.
   * Only present in tool messages.
   */
  name?: string

  /**
   * Optional model reasoning text associated with an assistant response.
   * Present when the provider supports reasoning and returns a final reasoning trace.
   */
  reasoning?: string

  /**
   * The role of the entity sending the message.
   * - 'system': System instructions or context
   * - 'user': End-user input
   * - 'assistant': LLM response
   * - 'tool': Result from a tool execution
   */
  role: 'assistant' | 'system' | 'tool' | 'user'

  /**
   * Raw thought text from the model (Gemini only).
   * Contains the model's thinking process before generating a response.
   */
  thought?: string

  /**
   * Parsed thought summary with subject and description (Gemini only).
   * Extracted from the thought text for easier display.
   */
  thoughtSummary?: {
    /**
     * Detailed description of the thought
     */
    description: string

    /**
     * Brief subject of the thought
     */
    subject: string
  }

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