import {AuthToken} from '../domain/entities/auth-token.js'

/**
 * Interface for authentication services.
 */
export interface IAuthService {
  /**
   * Builds the authorization URL for the OAuth flow.
   * @param state The state parameter to include in the authorization request.
   * @param codeVerifier The code verifier for PKCE.
   * @param redirectUri The redirect URI where authorization codes will be received.
   * @returns The authorization URL.
   */
  buildAuthorizationUrl: (state: string, codeVerifier: string, redirectUri: string) => string

  /**
   * Exchanges an authorization code for an access token.
   * @param code The authorization code to exchange.
   * @param codeVerifier The code verifier for PKCE.
   * @param redirectUri The redirect URI used in the authorization request (must match for OAuth 2.0 compliance).
   * @returns The access token.
   */
  exchangeCodeForToken: (code: string, codeVerifier: string, redirectUri: string) => Promise<AuthToken>

  /**
   * Refreshes an access token using a refresh token.
   * @param refreshToken The refresh token to use.
   * @returns The new access token.
   */
  refreshToken: (refreshToken: string) => Promise<AuthToken>
}
