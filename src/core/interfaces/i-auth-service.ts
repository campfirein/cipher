import {AuthToken} from '../domain/entities/auth-token.js'

/**
 * Authorization context containing the URL and state for OAuth flow.
 * The code_verifier is managed internally by the auth service.
 */
export type AuthorizationContext = {
  authUrl: string
  state: string
}

/**
 * Interface for authentication services.
 */
export interface IAuthService {
  /**
   * Exchanges an authorization code for an access token.
   * @param code The authorization code to exchange.
   * @param context The authorization context from initiateAuthorization (contains state for verifier lookup).
   * @param redirectUri The redirect URI used in the authorization request (must match for OAuth 2.0 compliance).
   * @returns The access token.
   */
  exchangeCodeForToken: (code: string, context: AuthorizationContext, redirectUri: string) => Promise<AuthToken>

  /**
   * Initiates the authorization flow by generating PKCE parameters and building the authorization URL.
   * The code_verifier is generated and stored internally by the service.
   * @param redirectUri The redirect URI where authorization codes will be received.
   * @returns Authorization context containing the URL and state for CSRF protection.
   */
  initiateAuthorization: (redirectUri: string) => AuthorizationContext

  /**
   * Refreshes an access token using a refresh token.
   * @param refreshToken The refresh token to use.
   * @returns The new access token.
   */
  refreshToken: (refreshToken: string) => Promise<AuthToken>
}
