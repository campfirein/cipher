import {IOidcDiscoveryService} from '../core/interfaces/i-oidc-discovery-service.js'
import {ENVIRONMENT, getCurrentConfig} from './environment.js'

/**
 * OAuth/OIDC configuration for the application.
 * This CLI uses PKCE flow (public client), so clientSecret is optional and typically undefined.
 */
export type OAuthConfig = {
  authorizationUrl: string
  clientId: string
  clientSecret?: string
  redirectUri: string
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

    // Warn user about fallback
    console.warn(
      `Warning: OIDC discovery failed, using fallback URLs for ${ENVIRONMENT} environment.`,
      error instanceof Error ? error.message : 'Unknown error',
    )
  }

  return {
    authorizationUrl,
    clientId: envConfig.clientId,
    redirectUri: '',
    scopes: envConfig.scopes,
    tokenUrl,
  }
}
