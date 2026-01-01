import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {isWsl} from '../../utils/environment-detector.js'
import {FileTokenStore} from './file-token-store.js'
import {KeychainTokenStore} from './keychain-token-store.js'

/**
 * Creates the appropriate token store for the current platform.
 *
 * - WSL: FileTokenStore (encrypted file-based, keychain not available)
 * - macOS/Linux/Windows: KeychainTokenStore (system keychain via keytar)
 *
 * @param isWslFn - Optional function to detect WSL (for testing)
 */
export function createTokenStore(isWslFn: () => boolean = isWsl): ITokenStore {
  return isWslFn() ? new FileTokenStore() : new KeychainTokenStore()
}
