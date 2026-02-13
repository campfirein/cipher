import type {ProviderConfig} from '../domain/entities/provider-config.js'

/**
 * Interface for storing and retrieving provider configuration.
 * Handles non-sensitive data (API keys stored separately in keychain).
 */
export interface IProviderConfigStore {
  /**
   * Marks a provider as connected.
   *
   * @param providerId The provider ID to mark as connected
   * @param options Optional settings like default model
   */
  connectProvider: (
    providerId: string,
    options?: {activeModel?: string; baseUrl?: string},
  ) => Promise<void>

  /**
   * Removes a provider connection.
   *
   * @param providerId The provider ID to disconnect
   */
  disconnectProvider: (providerId: string) => Promise<void>

  /**
   * Gets the active model for a provider.
   *
   * @param providerId The provider ID
   * @returns The active model ID or undefined
   */
  getActiveModel: (providerId: string) => Promise<string | undefined>

  /**
   * Gets the active provider ID.
   *
   * @returns The active provider ID
   */
  getActiveProvider: () => Promise<string>

  /**
   * Gets favorite models for a provider.
   *
   * @param providerId The provider ID
   * @returns Array of favorite model IDs
   */
  getFavoriteModels: (providerId: string) => Promise<readonly string[]>

  /**
   * Gets recent models for a provider.
   *
   * @param providerId The provider ID
   * @returns Array of recent model IDs
   */
  getRecentModels: (providerId: string) => Promise<readonly string[]>

  /**
   * Checks if a provider is connected.
   *
   * @param providerId The provider ID to check
   * @returns True if the provider is connected
   */
  isProviderConnected: (providerId: string) => Promise<boolean>

  /**
   * Reads the provider configuration.
   *
   * @returns The configuration if found, default config otherwise
   */
  read: () => Promise<ProviderConfig>

  /**
   * Sets the active model for a provider.
   *
   * @param providerId The provider ID
   * @param modelId The model ID to set as active
   */
  setActiveModel: (providerId: string, modelId: string) => Promise<void>

  /**
   * Sets the active provider.
   *
   * @param providerId The provider ID to set as active
   */
  setActiveProvider: (providerId: string) => Promise<void>

  /**
   * Toggles a model as favorite.
   *
   * @param providerId The provider ID
   * @param modelId The model ID to toggle
   */
  toggleFavorite: (providerId: string, modelId: string) => Promise<void>

  /**
   * Writes the provider configuration.
   *
   * @param config The configuration to write
   */
  write: (config: ProviderConfig) => Promise<void>
}
