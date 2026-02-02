import type {AuthToken} from '../../domain/entities/auth-token.js'

/**
 * Callback fired when auth state changes (login, refresh, logout).
 *
 * @param token - The new auth token, or undefined if logged out
 */
export type AuthChangedCallback = (token: AuthToken | undefined) => void

/**
 * Callback fired when auth token has expired.
 * Separate from AuthChanged because an expired token is still "present" —
 * it signals the need for refresh, not that the user logged out.
 */
export type AuthExpiredCallback = (token: AuthToken) => void

/**
 * Global auth state store shared across all projects.
 *
 * Polls the underlying token store to detect external changes
 * (login, token refresh, logout) and notifies listeners via callbacks.
 *
 * In M2 daemon architecture, this replaces the agent-worker's credential
 * polling. The daemon is the centralized auth state owner. In-process agents
 * call getToken() directly (shared reference, no Socket.IO push needed).
 *
 * Consumed by transport-worker (and future server-main.ts) wiring to
 * broadcast auth:updated and auth:expired events to all connected clients.
 */
export interface IAuthStateStore {
  /**
   * Get the current cached auth token.
   * Returns undefined if not loaded yet or user is logged out.
   */
  getToken(): AuthToken | undefined

  /**
   * Force a reload from the underlying token store.
   * Useful on daemon startup to populate the initial cache,
   * or when a client signals that auth state has changed.
   *
   * @returns The loaded token, or undefined if not found
   */
  loadToken(): Promise<AuthToken | undefined>

  /**
   * Register a callback for auth state changes.
   * Fired when: login (new token), token refresh (changed token), logout (undefined).
   *
   * @param callback - Function called with the new token (or undefined on logout)
   */
  onAuthChanged(callback: AuthChangedCallback): void

  /**
   * Register a callback for token expiry.
   * Fired when a token that was valid transitions to expired.
   * Only fires once per expiry (not on every poll cycle).
   *
   * @param callback - Function called with the expired token
   */
  onAuthExpired(callback: AuthExpiredCallback): void

  /**
   * Start polling the token store for changes.
   * Must be called after construction to begin monitoring.
   */
  startPolling(): void

  /**
   * Stop polling and clean up resources.
   * Must be called during shutdown.
   */
  stopPolling(): void
}
