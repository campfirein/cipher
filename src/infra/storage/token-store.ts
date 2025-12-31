import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {isWSL2} from '../../utils/environment-detector.js'
import {FileTokenStore} from './file-token-store.js'
import {KeychainTokenStore} from './keychain-token-store.js'

/**
 * Creates the appropriate token store for the current platform.
 *
 * - WSL2: FileTokenStore (encrypted file-based, keychain not available)
 * - macOS/Linux/Windows: KeychainTokenStore (system keychain via keytar)
 *
 * @param isWSL2Fn - Optional function to detect WSL2 (for testing)
 */
export function createTokenStore(isWSL2Fn: () => boolean = isWSL2): ITokenStore {
  return isWSL2Fn() ? new FileTokenStore() : new KeychainTokenStore()
}
