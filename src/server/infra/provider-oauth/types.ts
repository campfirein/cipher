export type ProviderCallbackResult = {
  code: string
  state: string
}

export type PkceParameters = {
  codeChallenge: string
  codeVerifier: string
  state: string
}

export type TokenRequestContentType = 'application/json' | 'application/x-www-form-urlencoded'

/**
 * Raw token response from an OAuth provider.
 * Fields are snake_case per OAuth 2.0 spec (RFC 6749).
 */
export type ProviderTokenResponse = {
  access_token: string
  expires_in?: number
  id_token?: string
  refresh_token?: string
  scope?: string
  token_type?: string
}

export type RefreshTokenExchangeParams = {
  clientId: string
  contentType: TokenRequestContentType
  refreshToken: string
  tokenUrl: string
}

export type TokenExchangeParams = {
  clientId: string
  clientSecret?: string
  code: string
  codeVerifier: string
  contentType: TokenRequestContentType
  redirectUri: string
  tokenUrl: string
}

/** Compute an ISO 8601 expiry timestamp from an OAuth expires_in value (seconds). */
export function computeExpiresAt(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString()
}
