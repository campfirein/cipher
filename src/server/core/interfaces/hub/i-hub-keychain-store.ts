/**
 * Interface for securely storing private hub registry auth tokens.
 * Uses system keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager)
 * or file-based encrypted fallback.
 */
export interface IHubKeychainStore {
  /**
   * Deletes the auth token for a registry.
   *
   * @param registryName The registry name
   */
  deleteToken(registryName: string): Promise<void>

  /**
   * Gets the auth token for a registry.
   *
   * @param registryName The registry name
   * @returns The auth token if found, undefined otherwise
   */
  getToken(registryName: string): Promise<string | undefined>

  /**
   * Sets the auth token for a registry.
   *
   * @param registryName The registry name
   * @param token The auth token to store
   */
  setToken(registryName: string, token: string): Promise<void>
}
