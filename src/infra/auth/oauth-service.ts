/* eslint-disable camelcase */
import axios, {isAxiosError} from 'axios'
import crypto from 'node:crypto'

import {OAuthConfig} from '../../config/auth.config.js'
import {AuthToken} from '../../core/domain/entities/auth-token.js'
import {AuthenticationError} from '../../core/domain/errors/auth-error.js'
import {IAuthService} from '../../core/interfaces/i-auth-service.js'

/**
 * OAuth service implementation for handling OAuth authentication flows.
 */
export class OAuthService implements IAuthService {
  private readonly config: OAuthConfig

  public constructor(config: OAuthConfig) {
    this.config = config
  }

  /**
   * Builds the authorization URL for the OAuth flow.
   * @param state The state parameter for CSRF protection.
   * @param codeVerifier The code verifier for PKCE.
   * @param redirectUri The redirect URI where authorization codes will be received.
   * @returns The complete authorization URL.
   */
  public buildAuthorizationUrl(state: string, codeVerifier: string, redirectUri: string): string {
    const codeChallenge = this.generateCodeChallenge(codeVerifier)

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
    })

    return `${this.config.authorizationUrl}?${params.toString()}`
  }

  /**
   * Exchanges an authorization code for an access token.
   * @param code The authorization code received from the authorization server.
   * @param codeVerifier The code verifier for PKCE.
   * @param redirectUri The redirect URI used in the authorization request (must match for OAuth 2.0 compliance).
   * @returns The access token with refresh token and expiration.
   */
  public async exchangeCodeForToken(code: string, codeVerifier: string, redirectUri: string): Promise<AuthToken> {
    try {
      const response = await axios.post(this.config.tokenUrl, {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      })

      return this.parseTokenResponse(response.data)
    } catch (error) {
      if (isAxiosError(error)) {
        throw new AuthenticationError(
          error.response?.data?.error_description ?? 'Failed to exchange code for token',
          error.response?.data?.error,
        )
      }

      throw error
    }
  }

  public async refreshToken(refreshToken: string): Promise<AuthToken> {
    try {
      const response = await axios.post(this.config.tokenUrl, {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })

      return this.parseTokenResponse(response.data)
    } catch (error) {
      if (isAxiosError(error)) {
        throw new AuthenticationError(
          error.response?.data?.error_description ?? 'Failed to refresh token',
          error.response?.data?.error,
        )
      }

      throw error
    }
  }

  /**
   * Generates a code challenge from a code verifier using SHA-256 and base64url encoding.
   * @param codeVerifier The code verifier.
   * @returns The code challenge.
   */
  private generateCodeChallenge(codeVerifier: string): string {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  }

  /**
   * Parses the token response from the OAuth server.
   * @param data The response data from the OAuth server.
   * @param data.access_token The access token string.
   * @param data.refresh_token The refresh token string.
   * @param data.expires_in The token expiration time in seconds.
   * @param data.token_type The type of token (e.g., "Bearer").
   * @returns The parsed AuthToken.
   */
  private parseTokenResponse(data: {
    access_token: string
    expires_in: number
    refresh_token: string
    token_type: string
  }): AuthToken {
    const expiresAt = new Date(Date.now() + data.expires_in * 1000)
    return new AuthToken(data.access_token, data.refresh_token, expiresAt, data.token_type)
  }
}
