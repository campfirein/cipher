/**
 * OAuth Token Record
 *
 * Stores the refresh token and expiry for a single OAuth-connected provider.
 * Access tokens are stored separately in the provider keychain store.
 */
export type OAuthTokenRecord = {
  /** Token expiry as ISO 8601 timestamp */
  readonly expiresAt: string
  /** OAuth refresh token (used to obtain new access tokens) */
  readonly refreshToken: string
}

/**
 * Interface for securely storing OAuth token metadata per provider.
 *
 * Separate from the provider keychain (which stores access tokens as "API keys").
 * Implementations must encrypt data at rest.
 */
export interface IProviderOAuthTokenStore {
  delete(providerId: string): Promise<void>
  get(providerId: string): Promise<OAuthTokenRecord | undefined>
  has(providerId: string): Promise<boolean>
  set(providerId: string, data: OAuthTokenRecord): Promise<void>
}
