/**
 * Interface for hook session storage operations.
 * Enables dependency injection and testing.
 */

import type {HookSession} from '../../../coding-agent-hooks/claude/schemas.js'

export interface IHookSessionStore {
  /**
   * Remove sessions older than maxAgeMs.
   * @param maxAgeMs - Maximum session age in milliseconds (default: 24 hours)
   */
  cleanup(maxAgeMs?: number): Promise<void>

  /**
   * Read a session by ID.
   * @param sessionId - Session ID to retrieve
   * @returns Session data or undefined if not found
   */
  read(sessionId: string): Promise<HookSession | undefined>

  /**
   * Write a session.
   * @param session - Session data to store
   */
  write(session: HookSession): Promise<void>
}
