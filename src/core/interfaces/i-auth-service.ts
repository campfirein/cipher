import {AuthToken} from '../domain/entities/auth-token.js'

/**
 * Interface for authentication services.
 */
export interface IAuthService {
  buildAuthorizationUrl: (state: string, codeVerifier: string) => string
  exchangeCodeForToken: (code: string, codeVerifier: string) => Promise<AuthToken>
  refreshToken: (refreshToken: string) => Promise<AuthToken>
}
