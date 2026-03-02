import type {SessionInfo} from '../../../../agent/core/domain/session/session-metadata.js'

/**
 * Interface for reading session metadata.
 * Minimal read-only interface for server-side session discovery.
 */
export interface ISessionReader {
  /**
   * List all session metadata files.
   *
   * @returns Array of session info sorted by lastUpdated (newest first)
   */
  listSessions(): Promise<SessionInfo[]>
}
