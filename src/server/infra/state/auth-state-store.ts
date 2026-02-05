import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {ITokenStore} from '../../core/interfaces/auth/i-token-store.js'
import type {
  AuthChangedCallback,
  AuthExpiredCallback,
  IAuthStateStore,
} from '../../core/interfaces/state/i-auth-state-store.js'

import {AUTH_STATE_POLL_INTERVAL_MS} from '../../constants.js'

type AuthStateStoreOptions = {
  /** Logging function (optional, defaults to no-op) */
  log?: (message: string) => void
  /** Polling interval in milliseconds (optional, defaults to AUTH_STATE_POLL_INTERVAL_MS) */
  pollIntervalMs?: number
  /** The underlying token store to poll */
  tokenStore: ITokenStore
}

/**
 * Global auth state store.
 *
 * Polls ITokenStore at a configurable interval to detect external changes
 * (login via TUI/CLI, token refresh, logout). Maintains an in-memory cache
 * of the current AuthToken and fires callbacks on state transitions.
 *
 * Change detection: compares accessToken strings.
 * - New token (was undefined, now has value): fires onAuthChanged
 * - Changed token (different accessToken): fires onAuthChanged
 * - Removed token (was present, now undefined): fires onAuthChanged(undefined)
 * - Expired token (was valid, now expired): fires onAuthExpired (once)
 *
 * Uses an isPolling guard to prevent overlapping poll cycles.
 */
export class AuthStateStore implements IAuthStateStore {
  private authChangedCallback: AuthChangedCallback | undefined
  private authExpiredCallback: AuthExpiredCallback | undefined
  private cachedToken: AuthToken | undefined
  private isPolling = false
  private readonly log: (message: string) => void
  private pollInterval: ReturnType<typeof setInterval> | undefined
  private readonly pollIntervalMs: number
  private readonly tokenStore: ITokenStore
  /** Track whether previous poll found the token expired (avoid repeat callbacks) */
  private wasExpired = false

  constructor(options: AuthStateStoreOptions) {
    this.tokenStore = options.tokenStore
    this.pollIntervalMs = options.pollIntervalMs ?? AUTH_STATE_POLL_INTERVAL_MS
    this.log = options.log ?? (() => {})
  }

  getToken(): AuthToken | undefined {
    return this.cachedToken
  }

  async loadToken(): Promise<AuthToken | undefined> {
    try {
      const token = await this.tokenStore.load()
      this.updateCachedToken(token)
      return this.cachedToken
    } catch (error) {
      this.log(`Failed to load token: ${error instanceof Error ? error.message : String(error)}`)
      return this.cachedToken
    }
  }

  onAuthChanged(callback: AuthChangedCallback): void {
    this.authChangedCallback = callback
  }

  onAuthExpired(callback: AuthExpiredCallback): void {
    this.authExpiredCallback = callback
  }

  startPolling(): void {
    if (this.pollInterval) return

    this.pollInterval = setInterval(() => {
      // eslint-disable-next-line no-void
      void this.pollOnce()
    }, this.pollIntervalMs)

    this.log('Auth state polling started')
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = undefined
    }

    this.log('Auth state polling stopped')
  }

  /**
   * Single poll cycle. Loads token from store and compares with cached.
   * Skips if a poll is already in-flight.
   */
  private async pollOnce(): Promise<void> {
    if (this.isPolling) return

    this.isPolling = true
    try {
      const token = await this.tokenStore.load()
      this.updateCachedToken(token)
    } catch (error) {
      this.log(`Auth poll error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.isPolling = false
    }
  }

  /**
   * Compare loaded token with cached and fire appropriate callbacks.
   */
  private updateCachedToken(token: AuthToken | undefined): void {
    const previousAccessToken = this.cachedToken?.accessToken
    const newAccessToken = token?.accessToken

    // Detect change: different accessToken (including undefined <-> defined)
    if (previousAccessToken !== newAccessToken) {
      this.cachedToken = token
      this.wasExpired = false
      this.log(`Auth state changed: ${token ? 'token present' : 'token removed'}`)
      this.authChangedCallback?.(token)
      return
    }

    // Same token — check for expiry transition
    if (token && token.isExpired() && !this.wasExpired) {
      this.wasExpired = true
      this.log('Auth token expired')
      this.authExpiredCallback?.(token)
    }

    // Update cached reference (same accessToken but other fields may differ)
    this.cachedToken = token
  }
}
