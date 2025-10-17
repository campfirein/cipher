import {AuthToken} from '../domain/entities/auth-token.js'

/**
 * Interface for authentication services.
 */
export interface IAuthService {
  exchangeCodeForToken: (code: string, codeVerifier: string) => Promise<AuthToken>
  getAuthorizationUrl: (state: string, codeVerifier: string) => string
  refreshToken: (refreshToken: string) => Promise<AuthToken>
}
