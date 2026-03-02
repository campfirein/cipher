import type {SessionMetadata} from '../../core/domain/storage/history-types.js'
import type {IHistoryStorage} from '../../core/interfaces/i-history-storage.js'
import type {InternalMessage} from '../../core/interfaces/message-types.js'
import type {BlobHistoryStorage} from './blob-history-storage.js'
import type {GranularHistoryStorage} from './granular-history-storage.js'

/**
 * Dual-format history storage that routes between blob and granular storage.
 *
 * This router implements the "no migration" strategy:
 * - NEW sessions → GranularHistoryStorage (message-per-key with streaming)
 * - EXISTING sessions → BlobHistoryStorage (legacy single-blob format)
 *
 * Format detection:
 * - Granular format: has a session record at ["session", sessionId]
 * - Blob format: has a blob at "session-{sessionId}"
 * - New session: neither exists, uses granular format
 *
 * This allows seamless coexistence of both formats without migration.
 */
export class DualFormatHistoryStorage implements IHistoryStorage {
  constructor(
    private readonly blobStorage: BlobHistoryStorage,
    private readonly granularStorage: GranularHistoryStorage,
  ) {}

  /**
   * Append a single message to the session history.
   * Routes to appropriate storage based on session format.
   * New sessions use granular format.
   */
  async appendMessage(sessionId: string, message: InternalMessage): Promise<void> {
    const format = await this.detectFormat(sessionId)

    if (format === 'granular') {
      return this.granularStorage.appendMessage(sessionId, message)
    }

    if (format === 'blob') {
      return this.blobStorage.appendMessage(sessionId, message)
    }

    // New session - use granular format
    return this.granularStorage.appendMessage(sessionId, message)
  }

  /**
   * Delete all history for a session.
   * Deletes from both storages to ensure complete cleanup.
   */
  async deleteHistory(sessionId: string): Promise<void> {
    const format = await this.detectFormat(sessionId)

    if (format === 'granular') {
      await this.granularStorage.deleteHistory(sessionId)
    } else if (format === 'blob') {
      await this.blobStorage.deleteHistory(sessionId)
    }
    // For 'none', nothing to delete
  }

  /**
   * Check if history exists for a session in either format.
   */
  async exists(sessionId: string): Promise<boolean> {
    const format = await this.detectFormat(sessionId)
    return format !== 'none'
  }

  /**
   * Get the underlying granular storage for advanced operations.
   * Returns undefined if session is not in granular format.
   */
  async getGranularStorage(sessionId: string): Promise<GranularHistoryStorage | undefined> {
    const format = await this.detectFormat(sessionId)

    if (format === 'granular' || format === 'none') {
      return this.granularStorage
    }

    return undefined
  }

  /**
   * Get metadata for a session from appropriate storage.
   */
  async getSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined> {
    const format = await this.detectFormat(sessionId)

    if (format === 'granular') {
      return this.granularStorage.getSessionMetadata(sessionId)
    }

    if (format === 'blob') {
      return this.blobStorage.getSessionMetadata(sessionId)
    }

    return undefined
  }

  /**
   * Check if a session uses granular format.
   * Useful for consumers that want to use granular-specific features.
   */
  async isGranularFormat(sessionId: string): Promise<boolean> {
    const format = await this.detectFormat(sessionId)
    return format === 'granular'
  }

  /**
   * List all session IDs from both storage formats.
   */
  async listSessions(): Promise<string[]> {
    const [blobSessions, granularSessions] = await Promise.all([
      this.blobStorage.listSessions(),
      this.granularStorage.listSessions(),
    ])

    // Combine and deduplicate (shouldn't have duplicates, but be safe)
    const allSessions = new Set([...blobSessions, ...granularSessions])
    return [...allSessions]
  }

  /**
   * Load conversation history for a session.
   * Routes to appropriate storage based on session format.
   */
  async loadHistory(sessionId: string): Promise<InternalMessage[] | undefined> {
    const format = await this.detectFormat(sessionId)

    if (format === 'granular') {
      return this.granularStorage.loadHistory(sessionId)
    }

    if (format === 'blob') {
      return this.blobStorage.loadHistory(sessionId)
    }

    // New session - return undefined (no history yet)
    return undefined
  }

  /**
   * Save conversation history for a session.
   * Routes to appropriate storage based on session format.
   *
   * New sessions use granular format.
   * Existing sessions stay in their original format.
   */
  async saveHistory(sessionId: string, messages: InternalMessage[]): Promise<void> {
    const format = await this.detectFormat(sessionId)

    if (format === 'granular') {
      return this.granularStorage.saveHistory(sessionId, messages)
    }

    if (format === 'blob') {
      // Keep existing blob sessions in blob format
      return this.blobStorage.saveHistory(sessionId, messages)
    }

    // New session - use granular format
    return this.granularStorage.saveHistory(sessionId, messages)
  }

  /**
   * Detect which storage format a session uses.
   *
   * Priority:
   * 1. Granular format (check first as it's the newer format)
   * 2. Blob format (legacy)
   * 3. None (new session)
   */
  private async detectFormat(sessionId: string): Promise<'blob' | 'granular' | 'none'> {
    // Check granular format first (newer, preferred)
    const isGranular = await this.granularStorage.exists(sessionId)
    if (isGranular) {
      return 'granular'
    }

    // Check blob format (legacy)
    const isBlob = await this.blobStorage.exists(sessionId)
    if (isBlob) {
      return 'blob'
    }

    // New session
    return 'none'
  }
}

/**
 * Factory function to create DualFormatHistoryStorage.
 */
export function createDualFormatHistoryStorage(
  blobStorage: BlobHistoryStorage,
  granularStorage: GranularHistoryStorage,
): DualFormatHistoryStorage {
  return new DualFormatHistoryStorage(blobStorage, granularStorage)
}
