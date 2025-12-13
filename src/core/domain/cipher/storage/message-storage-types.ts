/**
 * Types for granular message and part storage.
 *
 * This module defines the storage format for the new granular history system,
 * where messages and parts are stored separately to enable:
 * - Streaming message loading (newest to oldest)
 * - Selective tool output pruning
 * - Compaction boundary markers
 *
 * Storage key structure:
 * - ["session", sessionId] → SessionRecord
 * - ["message", sessionId, messageId] → StoredMessage
 * - ["part", messageId, partId] → StoredPart
 */

import type {ToolCall} from '../../../interfaces/cipher/message-types.js'

/**
 * Session-level record stored at ["session", sessionId].
 * Contains metadata and acts as a marker for granular format detection.
 */
export interface SessionRecord {
  /** Unix timestamp when session was created */
  createdAt: number

  /** ID of the latest compaction boundary message, if any */
  lastCompactionMessageId?: string

  /** Total number of messages in the session */
  messageCount: number

  /** ID of the most recent message for efficient iteration */
  newestMessageId?: string

  /** ID of the oldest message for complete traversal */
  oldestMessageId?: string

  /** Unique session identifier */
  sessionId: string

  /** Optional user-provided or auto-generated title */
  title?: string

  /** Unix timestamp of last update */
  updatedAt: number
}

/**
 * Individual message stored at ["message", sessionId, messageId].
 *
 * Messages are stored individually to enable:
 * - Streaming from newest to oldest
 * - Efficient single-message updates
 * - Compaction boundary markers
 */
export interface StoredMessage {
  /**
   * Flag indicating this is a compaction boundary.
   * When loading history, stop at the first compaction boundary.
   * Messages before this point are summarized and not needed.
   */
  compactionBoundary?: boolean

  /**
   * Summary content if this is a compaction boundary message.
   * Contains the LLM-generated summary of prior conversation.
   */
  compactionSummary?: string

  /**
   * The text content of the message.
   * - null for assistant messages with only tool calls
   * - string for most messages
   */
  content: null | string

  /** Unix timestamp when message was created */
  createdAt: number

  /** Unique message identifier (UUID) */
  id: string

  /**
   * Name of the tool that produced this result.
   * Only present for tool messages.
   */
  name?: string

  /** ID of the next message (toward newest) for linked traversal */
  nextMessageId?: string

  /** IDs of parts associated with this message, in order */
  partIds: string[]

  /** ID of the previous message (toward oldest) for linked traversal */
  prevMessageId?: string

  /** Optional reasoning text from the model */
  reasoning?: string

  /** Message role */
  role: 'assistant' | 'system' | 'tool' | 'user'

  /** Session this message belongs to */
  sessionId: string

  /** Raw thought text from the model (Gemini) */
  thought?: string

  /** Parsed thought summary (Gemini) */
  thoughtSummary?: {
    description: string
    subject: string
  }

  /**
   * ID of the tool call this message is responding to.
   * Only present for tool messages.
   */
  toolCallId?: string

  /**
   * Tool calls made by the assistant.
   * Only present for assistant messages requesting tool execution.
   */
  toolCalls?: ToolCall[]

  /** Unix timestamp of last update */
  updatedAt: number
}

/**
 * Message part stored at ["part", messageId, partId].
 *
 * Parts contain content that may be pruned independently:
 * - Tool outputs (large, can be marked as compacted)
 * - File attachments
 * - Image data
 *
 * Parts are stored separately to enable:
 * - Selective pruning of old tool outputs
 * - Lazy loading of large content
 * - Efficient streaming without loading all content
 */
export interface StoredPart {
  /**
   * Unix timestamp when this part was marked as compacted.
   * If set, the original content has been cleared to save space,
   * and a placeholder message should be shown instead.
   */
  compactedAt?: number

  /**
   * The actual content of the part.
   * - Tool output: string (JSON or text)
   * - File: base64 encoded data or file path
   * - Text: raw text content
   * - Image: base64 encoded data
   *
   * When compactedAt is set, this will be empty or contain a placeholder.
   */
  content: string

  /** Unix timestamp when part was created */
  createdAt: number

  /** Original filename for file parts */
  filename?: string

  /** Unique part identifier (UUID) */
  id: string

  /** ID of the message this part belongs to */
  messageId: string

  /** MIME type for file and image parts */
  mimeType?: string

  /**
   * For tool_output parts, the name of the tool.
   * Used for display and filtering.
   */
  toolName?: string

  /** Type of part content */
  type: 'compaction' | 'file' | 'image' | 'text' | 'tool_output'
}

/**
 * Placeholder message shown when tool output has been compacted.
 */
export const COMPACTED_TOOL_OUTPUT_PLACEHOLDER = '[Old tool result content cleared]'

/**
 * Result of loading messages with compaction awareness.
 */
export interface LoadMessagesResult {
  /** Whether a compaction boundary was reached */
  hitCompactionBoundary: boolean

  /** Loaded messages in chronological order (oldest first) */
  messages: StoredMessageWithParts[]
}

/**
 * StoredMessage combined with its resolved parts.
 * Used when converting back to InternalMessage format.
 */
export interface StoredMessageWithParts extends StoredMessage {
  /** Resolved part objects (not just IDs) */
  parts: StoredPart[]
}

/**
 * Configuration for message streaming.
 */
export interface StreamMessagesOptions {
  /**
   * Maximum number of messages to load.
   * Useful for preview/summary views.
   */
  limit?: number

  /**
   * Session ID to stream messages from.
   */
  sessionId: string

  /**
   * Whether to stop at the first compaction boundary.
   * Default: true
   */
  stopAtCompaction?: boolean
}

/**
 * Configuration for tool output pruning.
 */
export interface PruneToolOutputsOptions {
  /**
   * Target token count to keep in tool outputs.
   * Tool outputs beyond this (from oldest) will be marked as compacted.
   * Default: 40000 (same as OpenCode PRUNE_PROTECT)
   */
  keepTokens?: number

  /**
   * Minimum tokens that must be recoverable to perform pruning.
   * If pruning would save less than this, skip it entirely.
   * Default: 20000 (same as OpenCode PRUNE_MINIMUM)
   */
  minimumTokens?: number

  /**
   * Number of recent user turns to protect from pruning.
   * Tool outputs in these turns will not be compacted.
   * Default: 2
   */
  protectedTurns?: number

  /**
   * Session ID to prune tool outputs from.
   */
  sessionId: string
}

/**
 * Compaction operation result.
 */
export interface CompactionResult {
  /** Number of parts that were compacted */
  compactedCount: number

  /** New compaction boundary message ID */
  compactionMessageId?: string

  /** Estimated tokens saved */
  tokensSaved: number
}
