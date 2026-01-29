import keytar from 'keytar'

import type {ITokenStore} from '../../core/interfaces/auth/i-token-store.js'

import {AuthToken} from '../../core/domain/entities/auth-token.js'

const SERVICE_NAME = 'byterover-cli'
const ACCOUNT_NAME = 'auth-token'

/**
 * Token store using system keychain via keytar.
 *
 * Note: This class should not be used directly. Use createTokenStore() instead,
 * which handles platform detection and selects the appropriate backend.
 */
export class KeychainTokenStore implements ITokenStore {
  public async clear(): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME)
    } catch {
      // Ignore errors (token may not exist, permissions, etc.)
    }
  }

  public async load(): Promise<AuthToken | undefined> {
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
    try {
      const data = JSON.stringify(token.toJson())
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, data)
    } catch (error) {
      throw new Error(`Failed to save token to keychain: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}
