import keytar from 'keytar'

import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {AuthToken} from '../../core/domain/entities/auth-token.js'
import {isWSL2} from '../../utils/environment-detector.js'
import {FileTokenStore} from './file-token-store.js'

const SERVICE_NAME = 'byterover-cli'
const ACCOUNT_NAME = 'auth-token'

/**
 * Token store using system keychain via keytar.
 * On WSL2, uses FileTokenStore directly (keychain not available).
 */
export class KeychainTokenStore implements ITokenStore {
  /** Lazy-loaded fallback store singleton for WSL2 */
  private static fallbackStore: ITokenStore | undefined

  private static getFallbackStore(): ITokenStore {
    if (KeychainTokenStore.fallbackStore === undefined) {
      KeychainTokenStore.fallbackStore = new FileTokenStore()
    }

    return KeychainTokenStore.fallbackStore
  }

  public async clear(): Promise<void> {
    if (isWSL2()) {
      await KeychainTokenStore.getFallbackStore().clear()
      return
    }

    try {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME)
    } catch {
      // Ignore errors (token may not exist, permissions, etc.)
    }
  }

  public async load(): Promise<AuthToken | undefined> {
    if (isWSL2()) {
      return KeychainTokenStore.getFallbackStore().load()
    }

    try {
      const data = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME)
      if (data === null) {
        return undefined
      }

      const deserialized = JSON.parse(data)
      return AuthToken.fromJson(deserialized)
    } catch {
      return undefined
    }
  }

  public async save(token: AuthToken): Promise<void> {
    if (isWSL2()) {
      await KeychainTokenStore.getFallbackStore().save(token)
      return
    }

    try {
      const data = JSON.stringify(token.toJson())
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, data)
    } catch (error) {
      throw new Error(`Failed to save token to keychain: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
