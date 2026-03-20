/**
 * Interface for the token refresh manager.
 * Used by resolveProviderConfig to transparently refresh OAuth tokens.
 */
export interface ITokenRefreshManager {
  refreshIfNeeded(providerId: string): Promise<boolean>
}
