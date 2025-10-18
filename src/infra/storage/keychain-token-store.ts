import keytar from 'keytar'

import type {ITokenStore} from '../../core/interfaces/i-token-store.js'

import {AuthToken} from '../../core/domain/entities/auth-token.js'

const SERVICE_NAME = 'byterover-cli'
const ACCOUNT_NAME = 'auth-token'

/**
 * Token store implementation using the system keychain via the keytar library.
 */
export class KeychainTokenStore implements ITokenStore {
  public async clear(): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME)
    } catch {
      // Ignore errors - token might not exist or keychain might be unavailable
    }
  }

  public async load(): Promise<AuthToken | undefined> {
    try {
      const data = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME)
      if (data === null) {
        return undefined
      }

      const deserialized = JSON.parse(data)
      return AuthToken.fromJSON(deserialized)
    } catch {
      // Return undefined on any error (missing token, invalid JSON, keychain errors)
      return undefined
    }
  }

  public async save(token: AuthToken): Promise<void> {
    try {
      const data = JSON.stringify(token)
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, data)
    } catch (error) {
      throw new Error(`Failed to save token to keychain: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
