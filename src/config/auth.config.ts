import {IOidcDiscoveryService} from '../core/interfaces/i-oidc-discovery-service.js'
import {ENVIRONMENT, getCurrentConfig} from './environment.js'

/**
 * OAuth/OIDC configuration for the application.
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
 * Configuration is built from environment-specific defaults (build-time)
 * and dynamically discovered endpoints (runtime).
 *
 * @param discoveryService OIDC discovery service for fetching endpoints
 * @returns OAuth configuration
 */
export const getAuthConfig = async (discoveryService: IOidcDiscoveryService): Promise<OAuthConfig> => {
  // Get build-time environment config
  const envConfig = getCurrentConfig()

  // Client credentials (from env or build-time config)
  const clientId = process.env.BR_CLIENT_ID ?? envConfig.clientId
  const clientSecret = process.env.BR_CLIENT_SECRET
  const scopes = process.env.BR_SCOPES ? process.env.BR_SCOPES.split(' ') : envConfig.scopes

  // Discover OIDC endpoints
  let authorizationUrl: string
  let tokenUrl: string

  try {
    const metadata = await discoveryService.discover(envConfig.issuerUrl)

    // Use discovered endpoints (allow explicit env var overrides for disaster recovery)
    authorizationUrl = process.env.BR_AUTH_URL ?? metadata.authorizationEndpoint
    tokenUrl = process.env.BR_TOKEN_URL ?? metadata.tokenEndpoint
  } catch (error) {
    // Fallback to hardcoded URLs if discovery fails
    const fallbackUrls = getFallbackUrls()
    authorizationUrl = process.env.BR_AUTH_URL ?? fallbackUrls.authorizationUrl
    tokenUrl = process.env.BR_TOKEN_URL ?? fallbackUrls.tokenUrl

    // Warn user about fallback
    console.warn(
      `Warning: OIDC discovery failed, using fallback URLs for ${ENVIRONMENT} environment.`,
      error instanceof Error ? error.message : 'Unknown error',
    )
  }

  return {
    authorizationUrl,
    clientId,
    clientSecret,
    redirectUri: '',
    scopes,
    tokenUrl,
  }
}

/**
 * Get fallback URLs for when discovery fails.
 * These are emergency-only URLs that match the current environment.
 */
const getFallbackUrls = (): {authorizationUrl: string; tokenUrl: string} => {
  if (ENVIRONMENT === 'production') {
    return {
      authorizationUrl: 'https://prod-beta-iam.byterover.dev/api/v1/oidc/authorize',
      tokenUrl: 'https://prod-beta-iam.byterover.dev/api/v1/oidc/token',
    }
  }

  return {
    authorizationUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc/authorize',
    tokenUrl: 'https://dev-beta-iam.byterover.dev/api/v1/oidc/token',
  }
}
