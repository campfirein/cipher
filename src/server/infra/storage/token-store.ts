import type {ITokenStore} from '../../core/interfaces/auth/i-token-store.js'

import {FileTokenStore} from './file-token-store.js'

/**
 * Creates the token store.
 * Uses file-based encrypted storage (AES-256-GCM) on all platforms.
 */
export function createTokenStore(): ITokenStore {
  return new FileTokenStore()
}
