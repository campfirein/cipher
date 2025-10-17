import {AuthToken} from '../domain/entities/auth-token.js'

/**
 * Interface for token storage mechanisms.
 */
export interface ITokenStore {
  clear: () => Promise<void>
  load: () => Promise<AuthToken | undefined>
  save: (token: AuthToken) => Promise<void>
}
