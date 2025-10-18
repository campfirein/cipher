/* eslint-disable camelcase */
import axios, {isAxiosError} from 'axios'
import crypto from 'node:crypto'

import {OAuthConfig} from '../../config/auth.config.js'
import {AuthToken} from '../../core/domain/entities/auth-token.js'
import {AuthenticationError} from '../../core/domain/errors/auth-error.js'
import {IAuthService} from '../../core/interfaces/i-auth-service.js'

export class OAuthService implements IAuthService {
  private readonly config: OAuthConfig

  public constructor(config: OAuthConfig) {
    this.config = config
  }

  public buildAuthorizationUrl(state: string, codeVerifier: string): string {
    // TODO: review the process of PKCE building
    const codeChallenge = this.generateCodeChallenge(codeVerifier)

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state,
    })

    return `${this.config.authorizationUrl}?${params.toString()}`
  }

  public async exchangeCodeForToken(code: string, codeVerifier: string): Promise<AuthToken> {
    try {
      // TODO: review the process of fetching things with axios
      const response = await axios.post(this.config.tokenUrl, {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: this.config.redirectUri,
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

  private generateCodeChallenge(codeVerifier: string): string {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  }

  private parseTokenResponse(data: any): AuthToken {
    // TODO: handle any in param
    const expiresAt = new Date(Date.now() + data.expires_in * 1000)
    return new AuthToken(data.access_token, data.refresh_token, expiresAt, data.token_type)
  }
}
