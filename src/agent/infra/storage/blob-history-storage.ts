import type {SessionHistoryData, SessionMetadata} from '../../core/domain/storage/history-types.js'
import type {IBlobStorage} from '../../core/interfaces/i-blob-storage.js'
import type {IHistoryStorage} from '../../core/interfaces/i-history-storage.js'
import type {InternalMessage} from '../../core/interfaces/message-types.js'

/**
 * Blob-based implementation of history storage.
 *
 * Stores conversation history as JSON blobs in the file system.
 * Each session gets its own blob file at `.brv/blobs/session-{sessionId}.blob`.
 *
 * Follows the same pattern as MemoryManager for consistency.
 */
export class BlobHistoryStorage implements IHistoryStorage {
  private static readonly SESSION_KEY_PREFIX = 'session-'

  /**
   * Creates a new blob history storage instance.
   *
   * @param blobStorage - The blob storage backend to use
   */
  public constructor(private readonly blobStorage: IBlobStorage) {}

  /**
   * Append a single message to the session history.
   * For blob storage, this loads existing history, appends, and re-saves.
   */
  public async appendMessage(sessionId: string, message: InternalMessage): Promise<void> {
    try {
      const existing = await this.loadHistory(sessionId)
      const messages = existing ?? []
      messages.push(message)
      await this.saveHistory(sessionId, messages)
    } catch (error) {
      console.error(`[BlobHistoryStorage] Failed to append message for session ${sessionId}:`, error)
    }
  }

  /**
   * Delete all history for a specific session.
   *
   * @param sessionId - Unique session identifier
   */
  public async deleteHistory(sessionId: string): Promise<void> {
    const key = this.getSessionKey(sessionId)

    try {
      await this.blobStorage.delete(key)
    } catch (error) {
      // Log error but don't throw - graceful degradation
      console.error(`[BlobHistoryStorage] Failed to delete history for session ${sessionId}:`, error)
    }
  }

  /**
   * Check if history exists for a specific session.
   *
   * @param sessionId - Unique session identifier
   * @returns True if history exists
   */
  public async exists(sessionId: string): Promise<boolean> {
    const key = this.getSessionKey(sessionId)

    try {
      return await this.blobStorage.exists(key)
    } catch (error) {
      console.error(`[BlobHistoryStorage] Error checking existence for session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Get metadata for a specific session without loading full history.
   *
   * @param sessionId - Unique session identifier
   * @returns Session metadata or undefined if not found
   */
  public async getSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined> {
    const key = this.getSessionKey(sessionId)

    try {
      const blob = await this.blobStorage.retrieve(key)

      if (!blob) {
        return undefined
      }

      // Parse JSON content to extract metadata
      const historyData: SessionHistoryData = JSON.parse(blob.content.toString('utf8'))

      return {
        createdAt: historyData.createdAt,
        lastActivity: historyData.updatedAt,
        messageCount: historyData.messageCount,
        sessionId: historyData.sessionId,
        title: historyData.metadata?.title as string | undefined,
      }
    } catch (error) {
      console.error(`[BlobHistoryStorage] Failed to get metadata for session ${sessionId}:`, error)
      return undefined
    }
  }

  /**
   * List all session IDs that have persisted history.
   *
   * @returns Array of session IDs
   */
  public async listSessions(): Promise<string[]> {
    try {
      const keys = await this.blobStorage.list(BlobHistoryStorage.SESSION_KEY_PREFIX)

      // Extract session IDs from keys (remove prefix)
      return keys.map(key => this.extractSessionId(key)).filter((id): id is string => id !== undefined)
    } catch (error) {
      console.error('[BlobHistoryStorage] Failed to list sessions:', error)
      return []
    }
  }

  /**
   * Load conversation history for a specific session.
   *
   * @param sessionId - Unique session identifier
   * @returns Array of messages, or undefined if session not found
   */
  public async loadHistory(sessionId: string): Promise<InternalMessage[] | undefined> {
    const key = this.getSessionKey(sessionId)

    try {
      const blob = await this.blobStorage.retrieve(key)

      if (!blob) {
        return undefined
      }

      // Parse JSON content
      const historyData: SessionHistoryData = JSON.parse(blob.content.toString('utf8'))

      // Removed verbose console.log for cleaner interactive UX
      // console.log(`[BlobHistoryStorage] Loaded ${historyData.messages.length} messages for session ${sessionId}`)

      return historyData.messages
    } catch (error) {
      console.error(`[BlobHistoryStorage] Failed to load history for session ${sessionId}:`, error)
      return undefined
    }
  }

  /**
   * Save conversation history for a specific session.
   *
   * @param sessionId - Unique session identifier
   * @param messages - Array of messages to persist
   */
  public async saveHistory(sessionId: string, messages: InternalMessage[]): Promise<void> {
    const key = this.getSessionKey(sessionId)

    // Check if session already exists to preserve createdAt timestamp
    const existingMetadata = await this.getSessionMetadata(sessionId)

    // Build history data structure
    const now = Date.now()
    const historyData: SessionHistoryData = {
      createdAt: existingMetadata?.createdAt ?? now, // Preserve original creation time
      messageCount: messages.length,
      messages,
      sessionId,
      updatedAt: now,
    }

    try {
      // Serialize to JSON with pretty-printing for inspectability
      const content = JSON.stringify(historyData, null, 2)

      // Store in blob storage
      await this.blobStorage.store(key, content, {
        contentType: 'application/json',
        tags: {
          sessionId,
          type: 'chat-history',
        },
      })

      // Removed verbose console.log for cleaner interactive UX
      // console.log(`[BlobHistoryStorage] Saved ${messages.length} messages for session ${sessionId}`)
    } catch (error) {
      // Log error but don't throw - graceful degradation
      console.error(`[BlobHistoryStorage] Failed to save history for session ${sessionId}:`, error)
    }
  }

  /**
   * Extract session ID from storage key.
   *
   * @param key - Storage key (e.g., "session-abc123")
   * @returns Session ID (e.g., "abc123") or undefined if invalid key
   */
  private extractSessionId(key: string): string | undefined {
    if (!key.startsWith(BlobHistoryStorage.SESSION_KEY_PREFIX)) {
      return undefined
    }

    return key.slice(BlobHistoryStorage.SESSION_KEY_PREFIX.length)
  }

  /**
   * Get storage key for a session.
   *
   * @param sessionId - Unique session identifier
   * @returns Storage key (e.g., "session-abc123")
   */
  private getSessionKey(sessionId: string): string {
    return `${BlobHistoryStorage.SESSION_KEY_PREFIX}${sessionId}`
  }
}
