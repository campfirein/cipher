/**
 * Interface for storing provider API keys securely.
 * Uses system keychain (macOS Keychain, Linux Secret Service, Windows Credential Manager).
 */
export interface IProviderKeychainStore {
  /**
   * Deletes the API key for a provider.
   *
   * @param providerId The provider ID
   */
  deleteApiKey: (providerId: string) => Promise<void>

  /**
   * Gets the API key for a provider.
   *
   * @param providerId The provider ID
   * @returns The API key if found, undefined otherwise
   */
  getApiKey: (providerId: string) => Promise<string | undefined>

  /**
   * Checks if an API key exists for a provider.
   *
   * @param providerId The provider ID
   * @returns True if an API key exists
   */
  hasApiKey: (providerId: string) => Promise<boolean>

  /**
   * Sets the API key for a provider.
   *
   * @param providerId The provider ID
   * @param apiKey The API key to store
   */
  setApiKey: (providerId: string, apiKey: string) => Promise<void>
}
