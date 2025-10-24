/* eslint-disable camelcase */
import axios, {isAxiosError} from 'axios'
import crypto from 'node:crypto'

import {OAuthConfig} from '../../config/auth.config.js'
import {AuthToken} from '../../core/domain/entities/auth-token.js'
import {AuthenticationError} from '../../core/domain/errors/auth-error.js'
import {AuthorizationContext, IAuthService} from '../../core/interfaces/i-auth-service.js'

type TokenResponse = {
  /**
   * Authorization header, bearer token.
   */
  access_token: string
  /**
   * In seconds.
   */
  expires_in: number
  id_token: string
  refresh_token: string
  scope: string
  /**
   * x-byterover-session-id header
   */
  session_key: string
  token_type: string
}

/**
 * OAuth service implementation for handling OAuth authentication flows.
 */
export class OAuthService implements IAuthService {
  private readonly config: OAuthConfig
  private readonly verifierStore: Map<string, string> = new Map()

  public constructor(config: OAuthConfig) {
    this.config = config
  }

  /**
   * Exchanges an authorization code for an access token.
   * @param code The authorization code received from the authorization server.
   * @param context The authorization context from initiateAuthorization (contains state for verifier lookup).
   * @param redirectUri The redirect URI used in the authorization request (must match for OAuth 2.0 compliance).
   * @returns The access token with refresh token and expiration.
   */
  public async exchangeCodeForToken(
    code: string,
    context: AuthorizationContext,
    redirectUri: string,
  ): Promise<AuthToken> {
    // Retrieve the code_verifier using the state from the context
    const codeVerifier = this.verifierStore.get(context.state)
    if (!codeVerifier) {
      throw new AuthenticationError(
        'Invalid authorization context: code_verifier not found. Context may be from a different service instance or already used.',
        'invalid_context',
      )
    }

    // Remove the code_verifier from the store (single-use)
    this.verifierStore.delete(context.state)

    try {
      const response = await axios.post(
        this.config.tokenUrl,
        {
          client_id: this.config.clientId,
          // client_secret is undefined for public clients using PKCE.
          client_secret: this.config.clientSecret,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      )

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

  /**
   * Initiates the authorization flow by generating PKCE parameters and building the authorization URL.
   * The code_verifier is generated and stored internally by the service.
   * @param redirectUri The redirect URI where authorization codes will be received.
   * @returns Authorization context containing the URL and state for CSRF protection.
   */
  public initiateAuthorization(redirectUri: string): AuthorizationContext {
    const codeVerifier = this.generateCodeVerifier()
    const state = this.generateState()
    const codeChallenge = this.generateCodeChallenge(codeVerifier)

    // Store the code_verifier mapped to the state for later retrieval
    this.verifierStore.set(state, codeVerifier)

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
    })

    const authUrl = `${this.config.authorizationUrl}?${params.toString()}`

    return {authUrl, state}
  }

  public async refreshToken(refreshToken: string): Promise<AuthToken> {
    try {
      const response = await axios.post(this.config.tokenUrl, {
        client_id: this.config.clientId,
        // client_secret is undefined for public clients using PKCE.
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
   * Generates a cryptographically secure code verifier for PKCE.
   * @returns A random code verifier string.
   */
  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url')
  }

  /**
   * Generates a cryptographically secure state parameter for CSRF protection.
   * @returns A random state string.
   */
  private generateState(): string {
    return crypto.randomBytes(16).toString('base64url')
  }

  /**
   * Parses the token response from the OAuth server.
   * @param data The response data from the OAuth server.
   * @returns The parsed AuthToken.
   */
  private parseTokenResponse(data: TokenResponse): AuthToken {
    const expiresAt = new Date(Date.now() + data.expires_in * 1000)

    return new AuthToken(data.access_token, expiresAt, data.refresh_token, data.session_key, data.token_type)
  }
}
