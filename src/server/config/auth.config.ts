import {IOidcDiscoveryService} from '../core/interfaces/auth/i-oidc-discovery-service.js'
import {ENVIRONMENT, getCurrentConfig} from './environment.js'

/**
 * OAuth/OIDC configuration for the application.
 * This CLI uses PKCE flow (public client), so clientSecret is optional and typically undefined.
 */
export type OAuthConfig = {
  authorizationUrl: string
  clientId: string
  clientSecret?: string
  /**
   * OAuth redirect URI for receiving authorization codes.
   *
   * For CLI flows with local callback servers, this is typically built dynamically
   * after the server starts on a random port (e.g., `http://localhost:3456/callback`).
   *
   * For other flows (web apps, etc.), this can be provided as a static value in config.
   *
   * Optional - can be omitted if redirectUri is determined at runtime.
   */
  redirectUri?: string
  scopes: string[]
  tokenUrl: string
}

/**
 * Get OAuth configuration using OIDC discovery.
 * Configuration is built from environment-specific defaults with fallback
 * to hardcoded URLs if discovery fails.
 *
 * @param discoveryService OIDC discovery service for fetching endpoints
 * @returns OAuth configuration
 */
export const getAuthConfig = async (discoveryService: IOidcDiscoveryService): Promise<OAuthConfig> => {
  // Get environment config
  const envConfig = getCurrentConfig()

  // Discover OIDC endpoints
  let authorizationUrl: string | undefined
  let tokenUrl: string | undefined

  try {
    const metadata = await discoveryService.discover(envConfig.issuerUrl)

    // Use discovered endpoints
    authorizationUrl = metadata.authorizationEndpoint
    tokenUrl = metadata.tokenEndpoint
  } catch (error) {
    // Fallback to hardcoded environment-specific URLs
    authorizationUrl = envConfig.authorizationUrl
    tokenUrl = envConfig.tokenUrl

    // Warn user about fallback with user-friendly error message
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const isNetworkError =
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ETIMEDOUT') ||
      errorMessage.includes('getaddrinfo') ||
      errorMessage.includes('network')

    if (isNetworkError) {
      // Throw error and let command handle exit
      throw new Error(
        '❌ Network error: Unable to connect to ByteRover servers. Please check your internet connection and try again.',
      )
    } else {
      console.warn(`Warning: OIDC discovery failed, using fallback URLs for ${ENVIRONMENT} environment.`, errorMessage)
    }
  }

  return {
    authorizationUrl,
    clientId: envConfig.clientId,
    scopes: envConfig.scopes,
    tokenUrl,
  }
}
