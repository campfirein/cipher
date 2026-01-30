import {AuthToken} from '../../domain/entities/auth-token.js'

/**
 * Interface for token storage mechanisms.
 */
export interface ITokenStore {
  /**
   * Clears the stored token.
   * @returns A promise that resolves when the token is cleared.
   */
  clear: () => Promise<void>

  /**
   * Loads the stored token.
   * @returns A promise that resolves with the loaded token or undefined if not found.
   */
  load: () => Promise<AuthToken | undefined>

  /**
   * Saves the token to storage.
   * @param token The token to save.
   * @returns A promise that resolves when the token is saved.
   */
  save: (token: AuthToken) => Promise<void>
}
