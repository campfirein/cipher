import type {SessionMetadata} from '../../core/domain/storage/history-types.js'
import type {IHistoryStorage} from '../../core/interfaces/i-history-storage.js'
import type {InternalMessage} from '../../core/interfaces/message-types.js'

import {MessageStorageService} from './message-storage-service.js'

/**
 * Granular history storage implementation using MessageStorageService.
 *
 * This implementation stores messages individually, enabling:
 * - Streaming message loading (newest to oldest)
 * - Selective tool output pruning
 * - Compaction boundary markers
 *
 * This is the primary history storage implementation.
 */
export class GranularHistoryStorage implements IHistoryStorage {
  constructor(private readonly messageStorage: MessageStorageService) {}

  /**
   * Append a single message to the session.
   * More efficient than saveHistory for incremental updates.
   */
  async appendMessage(sessionId: string, message: InternalMessage): Promise<void> {
    await this.messageStorage.saveMessage(sessionId, message)
  }

  /**
   * Delete all history for a session.
   */
  async deleteHistory(sessionId: string): Promise<void> {
    await this.messageStorage.deleteSession(sessionId)
  }

  /**
   * Check if history exists for a session.
   */
  async exists(sessionId: string): Promise<boolean> {
    return this.messageStorage.hasSession(sessionId)
  }

  /**
   * Get metadata for a session without loading full history.
   */
  async getSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined> {
    const session = await this.messageStorage.getSession(sessionId)
    if (!session) {
      return undefined
    }

    return {
      createdAt: session.createdAt,
      lastActivity: session.updatedAt,
      messageCount: session.messageCount,
      sessionId: session.sessionId,
      title: session.title,
    }
  }

  /**
   * List all session IDs with persisted history.
   */
  async listSessions(): Promise<string[]> {
    return this.messageStorage.listSessions()
  }

  /**
   * Load conversation history for a session.
   * Stops at compaction boundaries for efficient loading.
   */
  async loadHistory(sessionId: string): Promise<InternalMessage[] | undefined> {
    const hasSession = await this.messageStorage.hasSession(sessionId)
    if (!hasSession) {
      return undefined
    }

    const result = await this.messageStorage.loadMessages(sessionId, {stopAtCompaction: true})
    return this.messageStorage.toInternalMessages(result.messages)
  }

  /**
   * Save conversation history for a session.
   *
   * This is a complete replacement - it's more efficient to use
   * appendMessage() for incremental updates.
   */
  async saveHistory(sessionId: string, messages: InternalMessage[]): Promise<void> {
    // Check if session exists
    const existingSession = await this.messageStorage.getSession(sessionId)

    if (existingSession) {
      // For existing sessions, we need to detect what's new
      // Load existing messages to find the last one
      const existingResult = await this.messageStorage.loadMessages(sessionId, {stopAtCompaction: false})
      const existingCount = existingResult.messages.length

      if (messages.length > existingCount) {
        // Append only new messages
        const newMessages = messages.slice(existingCount)
        await this.messageStorage.saveMessages(sessionId, newMessages)
      }
      // If messages.length <= existingCount, nothing to do
      // We don't delete messages in this implementation
    } else {
      // New session - save all messages
      await this.messageStorage.saveMessages(sessionId, messages)
    }
  }

  /**
   * Stream messages from newest to oldest.
   * More memory efficient for large histories.
   *
   * @yields InternalMessage - Messages from the session history
   */
  async *streamHistory(
    sessionId: string,
    options?: {limit?: number; stopAtCompaction?: boolean},
  ): AsyncGenerator<InternalMessage> {
    const stream = this.messageStorage.streamMessages({
      limit: options?.limit,
      sessionId,
      stopAtCompaction: options?.stopAtCompaction ?? true,
    })

    for await (const storedMessage of stream) {
      yield this.messageStorage.toInternalMessage(storedMessage)
    }
  }
}

/**
 * Factory function to create GranularHistoryStorage.
 */
export function createGranularHistoryStorage(messageStorage: MessageStorageService): GranularHistoryStorage {
  return new GranularHistoryStorage(messageStorage)
}
