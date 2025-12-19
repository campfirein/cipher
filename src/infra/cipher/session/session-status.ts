/**
 * Session Status Manager
 *
 * Manages ephemeral session lifecycle states following the OpenCode pattern.
 * Tracks whether sessions are idle, busy, retrying, or waiting for permission.
 *
 * This is in-memory state only - does not persist across restarts.
 * Status changes are published via the event bus for UI consumption.
 */

import type {SessionStatusType} from '../../../core/domain/cipher/agent-events/types.js'
import type {SessionEventBus} from '../events/event-emitter.js'

/**
 * Session Status Manager.
 *
 * Provides centralized tracking of session lifecycle states.
 * Each session can be in one of four states:
 * - idle: Ready to accept new messages
 * - busy: Currently executing a request
 * - retry: Waiting to retry after a transient error
 * - waiting_permission: Waiting for user permission (e.g., tool confirmation)
 *
 * @example
 * ```typescript
 * const statusManager = new SessionStatusManager()
 *
 * // Get current status
 * const status = statusManager.get('session-123')
 * if (status.type === 'idle') {
 *   // Session is ready
 * }
 *
 * // Update status
 * statusManager.set('session-123', { type: 'busy' }, eventBus)
 *
 * // Clear status when session is disposed
 * statusManager.remove('session-123')
 * ```
 */
export class SessionStatusManager {
  private readonly status: Map<string, SessionStatusType> = new Map()

  /**
   * Get the current status of a session.
   * Returns 'idle' if no status has been set.
   *
   * @param sessionId - The session ID to get status for
   * @returns Current session status
   */
  public get(sessionId: string): SessionStatusType {
    return this.status.get(sessionId) ?? {type: 'idle'}
  }

  /**
   * Get all session statuses.
   * Useful for debugging or admin interfaces.
   *
   * @returns Map of session IDs to their statuses
   */
  public getAll(): ReadonlyMap<string, SessionStatusType> {
    return this.status
  }

  /**
   * Check if a session is busy (executing or retrying).
   *
   * @param sessionId - The session ID to check
   * @returns True if the session is busy or retrying
   */
  public isBusy(sessionId: string): boolean {
    const status = this.get(sessionId)
    return status.type === 'busy' || status.type === 'retry'
  }

  /**
   * Check if a session is idle and ready for new messages.
   *
   * @param sessionId - The session ID to check
   * @returns True if the session is idle
   */
  public isIdle(sessionId: string): boolean {
    return this.get(sessionId).type === 'idle'
  }

  /**
   * Remove a session's status.
   * Call this when a session is disposed.
   *
   * @param sessionId - The session ID to remove
   */
  public remove(sessionId: string): void {
    this.status.delete(sessionId)
  }

  /**
   * Set the status of a session and emit a status change event.
   *
   * @param sessionId - The session ID to update
   * @param newStatus - The new status to set
   * @param eventBus - Optional event bus to emit status change event
   */
  public set(sessionId: string, newStatus: SessionStatusType, eventBus?: SessionEventBus): void {
    const oldStatus = this.status.get(sessionId)

    // Only update and emit if status actually changed
    if (!this.statusEquals(oldStatus, newStatus)) {
      this.status.set(sessionId, newStatus)

      // Emit status change event if event bus provided
      if (eventBus) {
        eventBus.emit('session:statusChanged', {
          status: newStatus,
        })
      }
    }
  }

  /**
   * Transition a session to busy state.
   * Convenience method for the common case.
   *
   * @param sessionId - The session ID to update
   * @param eventBus - Optional event bus to emit status change event
   */
  public setBusy(sessionId: string, eventBus?: SessionEventBus): void {
    this.set(sessionId, {type: 'busy'}, eventBus)
  }

  /**
   * Transition a session to idle state.
   * Convenience method for the common case.
   *
   * @param sessionId - The session ID to update
   * @param eventBus - Optional event bus to emit status change event
   */
  public setIdle(sessionId: string, eventBus?: SessionEventBus): void {
    this.set(sessionId, {type: 'idle'}, eventBus)
  }

  /**
   * Transition a session to retry state.
   *
   * @param sessionId - The session ID to update
   * @param options - Retry options
   * @param options.attempt - Current retry attempt number
   * @param options.message - Human-readable retry message
   * @param options.nextRetryAt - Timestamp when next retry will occur
   * @param eventBus - Optional event bus to emit status change event
   */
  public setRetry(
    sessionId: string,
    options: {attempt: number; message: string; nextRetryAt: number},
    eventBus?: SessionEventBus,
  ): void {
    this.set(sessionId, {attempt: options.attempt, message: options.message, nextRetryAt: options.nextRetryAt, type: 'retry'}, eventBus)
  }

  /**
   * Transition a session to waiting_permission state.
   *
   * @param sessionId - The session ID to update
   * @param toolName - Name of the tool waiting for permission
   * @param eventBus - Optional event bus to emit status change event
   */
  public setWaitingPermission(sessionId: string, toolName: string, eventBus?: SessionEventBus): void {
    this.set(sessionId, {toolName, type: 'waiting_permission'}, eventBus)
  }

  /**
   * Compare two session statuses for equality.
   *
   * @param a - First status (may be undefined)
   * @param b - Second status
   * @returns True if statuses are equal
   */
  private statusEquals(a: SessionStatusType | undefined, b: SessionStatusType): boolean {
    if (!a) return false
    if (a.type !== b.type) return false

    switch (a.type) {
      case 'busy': {
        return true
      }

      case 'idle': {
        return true
      }

      case 'retry': {
        return (
          b.type === 'retry' && a.attempt === b.attempt && a.message === b.message && a.nextRetryAt === b.nextRetryAt
        )
      }

      case 'waiting_permission': {
        return b.type === 'waiting_permission' && a.toolName === b.toolName
      }

      default: {
        return false
      }
    }
  }
}

/**
 * Singleton instance of the session status manager.
 * Use this for global session status tracking.
 */
export const sessionStatusManager = new SessionStatusManager()
