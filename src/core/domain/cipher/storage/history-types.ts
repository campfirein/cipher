import type {InternalMessage} from '../../../interfaces/cipher/message-types.js'

/**
 * Persisted session history data structure.
 *
 * This structure is serialized to JSON and stored in blob storage.
 * Contains the complete conversation history plus metadata for the session.
 */
export interface SessionHistoryData {
  /** Unix timestamp when session was created */
  createdAt: number

  /** Number of messages in the conversation */
  messageCount: number

  /** All messages in chronological order */
  messages: InternalMessage[]

  /** Optional metadata for extensibility */
  metadata?: Record<string, unknown>

  /** Unique session identifier */
  sessionId: string

  /** Unix timestamp of last update */
  updatedAt: number
}

/**
 * Lightweight session metadata (stored separately from full history).
 *
 * Used for listing sessions without loading full message history.
 */
export interface SessionMetadata {
  /** Unix timestamp when session was created */
  createdAt: number

  /** Unix timestamp of last activity */
  lastActivity: number

  /** Number of messages in the session */
  messageCount: number

  /** Unique session identifier */
  sessionId: string

  /** Optional user-provided or auto-generated title */
  title?: string
}
