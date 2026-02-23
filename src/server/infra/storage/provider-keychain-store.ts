import type {IProviderKeychainStore} from '../../core/interfaces/i-provider-keychain-store.js'

import {FileProviderKeychainStore} from './file-provider-keychain-store.js'

/**
 * Creates the provider keychain store.
 * Uses file-based encrypted storage (AES-256-GCM) on all platforms.
 */
export function createProviderKeychainStore(): IProviderKeychainStore {
  return new FileProviderKeychainStore()
}
