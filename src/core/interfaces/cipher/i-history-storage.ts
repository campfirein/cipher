import type {SessionMetadata} from '../../domain/cipher/storage/history-types.js'
import type {InternalMessage} from '../cipher/message-types.js'

/**
 * Interface for session history persistence.
 *
 * Implementations can use different storage backends (blob storage, database, etc.)
 * to persist and restore conversation history across sessions.
 */
export interface IHistoryStorage {
  /**
   * Delete all history for a specific session.
   *
   * @param sessionId - Unique session identifier
   * @returns Promise that resolves when history is deleted
   */
  deleteHistory(sessionId: string): Promise<void>

  /**
   * Check if history exists for a specific session.
   *
   * @param sessionId - Unique session identifier
   * @returns Promise that resolves to true if history exists
   */
  exists(sessionId: string): Promise<boolean>

  /**
   * Get metadata for a specific session without loading full history.
   *
   * @param sessionId - Unique session identifier
   * @returns Promise that resolves to session metadata or undefined if not found
   */
  getSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined>

  /**
   * List all session IDs that have persisted history.
   *
   * @returns Promise that resolves to array of session IDs
   */
  listSessions(): Promise<string[]>

  /**
   * Load conversation history for a specific session.
   *
   * @param sessionId - Unique session identifier
   * @returns Promise that resolves to array of messages, or undefined if session not found
   */
  loadHistory(sessionId: string): Promise<InternalMessage[] | undefined>

  /**
   * Save conversation history for a specific session.
   * Overwrites any existing history for the session.
   *
   * @param sessionId - Unique session identifier
   * @param messages - Array of messages to persist
   * @returns Promise that resolves when history is saved
   */
  saveHistory(sessionId: string, messages: InternalMessage[]): Promise<void>
}
