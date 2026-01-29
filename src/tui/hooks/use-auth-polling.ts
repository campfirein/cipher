/**
 * Auth Polling Hook
 *
 * Periodically checks auth state and refreshes token when needed.
 */

import {isAxiosError} from 'axios'
import {useEffect, useRef} from 'react'

import type {AuthToken} from '../../core/domain/entities/auth-token.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {getAuthConfig} from '../../config/auth.config.js'
import {getCurrentConfig} from '../../config/environment.js'
import {AuthToken as AuthTokenClass} from '../../core/domain/entities/auth-token.js'
import {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import {OAuthService} from '../../infra/auth/oauth-service.js'
import {OidcDiscoveryService} from '../../infra/auth/oidc-discovery-service.js'
import {HttpUserService} from '../../infra/user/http-user-service.js'

/** Auth state polling interval in milliseconds (15 seconds) */
const AUTH_POLL_INTERVAL_MS = 15 * 1000

export interface UseAuthPollingOptions {
  /** Current auth token */
  authToken: AuthToken | undefined
  /** Callback when token is refreshed or cleared */
  onTokenChange: (token?: AuthToken) => void
  /** Token store for persistence */
  tokenStore: ITokenStore
  /** Tracking service for analytics */
  trackingService: ITrackingService
}

/**
 * Hook that polls auth state and refreshes token when needed.
 *
 * - Polls every 30 seconds when authorized
 * - Validates token by calling user API
 * - Refreshes token if validation fails
 * - Clears auth state if refresh fails
 */
export function useAuthPolling({authToken, onTokenChange, tokenStore, trackingService}: UseAuthPollingOptions): void {
  // Track if validation/refresh is in progress to prevent concurrent operations
  const isProcessingRef = useRef(false)

  useEffect(() => {
    // Only poll when authorized
    if (!authToken) {
      return
    }

    const checkAndRefreshAuth = async () => {
      // Skip if already processing
      if (isProcessingRef.current) {
        return
      }

      isProcessingRef.current = true

      try {
        // Validate token by calling user API
        const isValid = await validateToken(authToken)

        if (!isValid) {
          // Track token invalid event
          await trackingService.track('auth:token_invalid', {
            expiresAt: authToken.expiresAt.toUTCString(),
            sessionKey: authToken.sessionKey,
            userId: authToken.userId,
          })

          // Token invalid - attempt refresh
          await refreshToken(authToken, tokenStore, onTokenChange)
        }
      } finally {
        isProcessingRef.current = false
      }
    }

    // Run immediately on mount/token change
    checkAndRefreshAuth()

    // Set up polling interval
    const pollInterval = setInterval(checkAndRefreshAuth, AUTH_POLL_INTERVAL_MS)

    return () => {
      clearInterval(pollInterval)
    }
  }, [authToken, onTokenChange, tokenStore])
}

/**
 * Validate token by calling user API
 * @returns true if token is valid, false if 401 unauthorized
 * @throws on network errors (token validity unknown)
 */
async function validateToken(authToken: AuthToken): Promise<boolean> {
  const config = getCurrentConfig()
  const userService = new HttpUserService({apiBaseUrl: config.apiBaseUrl})

  try {
    // Try to get current user - if this fails with 401, token is invalid
    await userService.getCurrentUser(authToken.sessionKey)
    return true
  } catch (error) {
    // Only treat 401 as invalid token - network errors should not trigger refresh
    if (isAxiosError(error) && error.response?.status === 401) {
      return false
    }

    // For network errors or other issues, assume token is still valid
    // to avoid unnecessary refresh attempts
    return true
  }
}

/**
 * Refresh the token using refresh token
 */
async function refreshToken(
  authToken: AuthToken,
  tokenStore: ITokenStore,
  onTokenChange: (token?: AuthToken) => void,
): Promise<void> {
  try {
    const discoveryService = new OidcDiscoveryService()
    const authConfig = await getAuthConfig(discoveryService)
    const authService = new OAuthService(authConfig)

    // Refresh the token
    const newTokenData = await authService.refreshToken(authToken.refreshToken)

    // Create new AuthToken with refreshed data but preserve user info
    const refreshedToken = new AuthTokenClass({
      accessToken: newTokenData.accessToken,
      expiresAt: newTokenData.expiresAt,
      refreshToken: newTokenData.refreshToken,
      sessionKey: newTokenData.sessionKey,
      tokenType: newTokenData.tokenType,
      userEmail: authToken.userEmail,
      userId: authToken.userId,
    })

    // Persist the new token
    await tokenStore.save(refreshedToken)

    // Update state
    onTokenChange(refreshedToken)
  } catch {
    // Refresh failed - token is invalid, force logout
    await tokenStore.clear()
    onTokenChange()
  }
}
