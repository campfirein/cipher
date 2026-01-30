import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {shouldUseFileTokenStore} from '../../utils/environment-detector.js'
import {FileTokenStore} from './file-token-store.js'
import {KeychainTokenStore} from './keychain-token-store.js'

/**
 * Creates the appropriate token store for the current platform.
 *
 * - WSL: FileTokenStore (encrypted file-based, keychain not available)
 * - Headless Linux: FileTokenStore (no D-Bus/keyring daemon)
 * - macOS/Windows/Linux with GUI: KeychainTokenStore (system keychain via keytar)
 *
 * @param shouldUseFileFn - Optional function for environment detection (for testing)
 */
export function createTokenStore(shouldUseFileFn: () => boolean = shouldUseFileTokenStore): ITokenStore {
  return shouldUseFileFn() ? new FileTokenStore() : new KeychainTokenStore()
}
