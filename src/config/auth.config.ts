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
 * Get OAuth configuration from environment variables.
 * @returns OAuthConfig
 */
export const getAuthConfig = (): OAuthConfig => {
  const authorizationUrl = process.env.BR_AUTH_URL ?? 'https://dev-beta-iam.byterover.dev/api/v1/oidc/authorize'
  const clientId = process.env.BR_CLIENT_ID ?? 'byterover-cli-client'
  const clientSecret = process.env.BR_CLIENT_SECRET
  const scopes = (process.env.BR_SCOPES ?? 'read write').split(' ')
  const tokenUrl = process.env.BR_TOKEN_URL ?? 'https://auth.byterover.com/oauth/token'

  if (!clientId) {
    throw new Error('BR_CLIENT_ID environment variable is required')
  }

  return {
    authorizationUrl,
    clientId,
    clientSecret,
    redirectUri: 'http://localhost:0/callback',
    scopes,
    tokenUrl,
  }
}
