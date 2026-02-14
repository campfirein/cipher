/**
 * Provider Keychain Store
 *
 * Stores provider API keys securely in the system keychain.
 * Uses keytar for cross-platform keychain access.
 */

import keytar from 'keytar'

import type {IProviderKeychainStore} from '../../core/interfaces/i-provider-keychain-store.js'

import {shouldUseFileTokenStore} from '../../utils/environment-detector.js'
import {FileProviderKeychainStore} from './file-provider-keychain-store.js'

const SERVICE_NAME = 'byterover-cli-providers'

/**
 * Creates the account name for a provider.
 * Format: provider:<providerId>
 */
function getAccountName(providerId: string): string {
  return `provider:${providerId}`
}

/**
 * Keychain-based storage for provider API keys.
 * Uses the system keychain for secure storage:
 * - macOS: Keychain
 * - Linux: Secret Service (or encrypted file fallback)
 * - Windows: Credential Manager
 */
export class ProviderKeychainStore implements IProviderKeychainStore {
  /**
   * Deletes the API key for a provider.
   */
  public async deleteApiKey(providerId: string): Promise<void> {
    try {
      const accountName = getAccountName(providerId)
      await keytar.deletePassword(SERVICE_NAME, accountName)
    } catch {
      // Ignore errors (key may not exist, permissions, etc.)
    }
  }

  /**
   * Gets the API key for a provider.
   */
  public async getApiKey(providerId: string): Promise<string | undefined> {
    try {
      const accountName = getAccountName(providerId)
      const apiKey = await keytar.getPassword(SERVICE_NAME, accountName)
      return apiKey ?? undefined
    } catch {
      return undefined
    }
  }

  /**
   * Checks if an API key exists for a provider.
   */
  public async hasApiKey(providerId: string): Promise<boolean> {
    const apiKey = await this.getApiKey(providerId)
    return apiKey !== undefined
  }

  /**
   * Sets the API key for a provider.
   */
  public async setApiKey(providerId: string, apiKey: string): Promise<void> {
    try {
      const accountName = getAccountName(providerId)
      await keytar.setPassword(SERVICE_NAME, accountName, apiKey)
    } catch (error) {
      throw new Error(
        `Failed to save API key to keychain: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }
}

/**
 * Creates the appropriate provider keychain store for the current platform.
 *
 * - WSL: FileProviderKeychainStore (encrypted file-based, keychain not available)
 * - Headless Linux: FileProviderKeychainStore (no D-Bus/keyring daemon)
 * - macOS/Windows/Linux with GUI: ProviderKeychainStore (system keychain via keytar)
 *
 * @param shouldUseFileFn - Optional function for environment detection (for testing)
 */
export function createProviderKeychainStore(
  shouldUseFileFn: () => boolean = shouldUseFileTokenStore,
): IProviderKeychainStore {
  return shouldUseFileFn() ? new FileProviderKeychainStore() : new ProviderKeychainStore()
}
