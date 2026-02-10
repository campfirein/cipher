/**
 * Interface for Session Persistence Operations
 *
 * Defines the contract for session metadata storage and retrieval.
 * Implementation uses JSON files in the XDG sessions directory.
 */

import type {ActiveSessionPointer, SessionInfo, SessionMetadata} from '../domain/session/session-metadata.js'

/**
 * Session retention configuration for auto-cleanup.
 */
export interface SessionRetentionConfig {
  /** Maximum age in days before auto-cleanup */
  maxAgeDays: number

  /** Maximum number of sessions to keep */
  maxCount: number

  /** Whether to run cleanup on startup */
  runOnStartup: boolean
}

/**
 * Result of session cleanup operation.
 */
export interface SessionCleanupResult {
  /** Number of corrupted session files removed */
  corruptedRemoved: number

  /** Number of sessions deleted due to age */
  deletedByAge: number

  /** Number of sessions deleted due to count limit */
  deletedByCount: number

  /** Total sessions remaining after cleanup */
  remaining: number
}

/**
 * Interface for session metadata persistence.
 *
 * Manages session metadata stored in the XDG sessions directory:
 * - active.json: Current active session pointer
 * - session-*.json: Individual session metadata files
 */
export interface ISessionPersistence {
  // ============================================================================
  // Active Session Management
  // ============================================================================

  /**
   * Clean up expired sessions based on retention policy.
   *
   * @param config - Retention configuration
   * @returns Cleanup result with counts
   */
  cleanupSessions(config: SessionRetentionConfig): Promise<SessionCleanupResult>

  /**
   * Clear the active session pointer.
   * Removes active.json from sessions directory
   */
  clearActiveSession(): Promise<void>

  /**
   * Delete a session and its metadata.
   *
   * @param sessionId - Session ID to delete
   * @returns True if session was deleted, false if not found
   */
  deleteSession(sessionId: string): Promise<boolean>

  /**
   * Get the currently active session pointer.
   *
   * @returns Active session pointer or null if no active session
   */
  getActiveSession(): Promise<ActiveSessionPointer | null>

  /**
   * Get session metadata by ID.
   *
   * @param sessionId - Session ID to look up
   * @returns Session metadata or null if not found
   */
  getSession(sessionId: string): Promise<null | SessionMetadata>

  /**
   * Check if the active session pointer is stale (process not running).
   *
   * @returns True if active session exists but process is not running
   */
  isActiveSessionStale(): Promise<boolean>

  /**
   * Validate that a session belongs to the current working directory.
   *
   * @param sessionId - Session ID to validate
   * @returns True if session belongs to current project
   */
  isSessionForCurrentProject(sessionId: string): Promise<boolean>

  /**
   * List all session metadata files.
   *
   * @returns Array of session info sorted by lastUpdated (newest first)
   */
  listSessions(): Promise<SessionInfo[]>

  /**
   * Mark a session as ended.
   * Updates the session status to 'ended' and lastUpdated timestamp.
   *
   * @param sessionId - Session ID to mark as ended
   */
  markSessionEnded(sessionId: string): Promise<void>

  /**
   * Mark a session as interrupted (e.g., process crashed).
   * Updates the session status to 'interrupted'.
   *
   * @param sessionId - Session ID to mark as interrupted
   */
  markSessionInterrupted(sessionId: string): Promise<void>

  /**
   * Save session metadata to disk.
   * Creates or updates the session metadata file.
   *
   * @param metadata - Session metadata to save
   */
  saveSession(metadata: SessionMetadata): Promise<void>

  /**
   * Set the active session pointer.
   * Creates or updates active.json in sessions directory
   *
   * @param sessionId - Session ID to set as active
   */
  setActiveSession(sessionId: string): Promise<void>

  /**
   * Set session title from first user message.
   *
   * @param sessionId - Session ID to update
   * @param title - Session title
   */
  setSessionTitle(sessionId: string, title: string): Promise<void>

  /**
   * Update session activity (lastUpdated timestamp and message count).
   *
   * @param sessionId - Session ID to update
   * @param messageCount - Current message count
   */
  updateSessionActivity(sessionId: string, messageCount: number): Promise<void>
}
