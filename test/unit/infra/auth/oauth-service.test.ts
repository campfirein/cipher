/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'
import {restore} from 'sinon'

import {OAuthConfig} from '../../../../src/config/auth.config'
import {OAuthService} from '../../../../src/infra/auth/oauth-service'

describe('OAuthService', () => {
  let service: OAuthService
  let config: OAuthConfig

  const basePath = 'https://auth.example.com'
  const authorizationUri = '/oauth/authorize'
  const clientId = 'test-client-id'
  const clientSecret = 'test-client-secret'
  const tokenUri = '/oauth/token'

  beforeEach(() => {
    config = {
      authorizationUrl: `${basePath}${authorizationUri}`,
      clientId,
      clientSecret,
      redirectUri: 'http://localhost:3000/callback',
      scopes: ['read', 'write'],
      tokenUrl: `${basePath}${tokenUri}`,
    }
    service = new OAuthService(config)
  })

  afterEach(() => {
    nock.cleanAll()
    restore()
  })

  describe('buildAuthorizationUrl', () => {
    it('should build authorization URL with PKCE parameters', () => {
      const state = 'test-state'
      const codeVerifier = 'test-verifier'

      const url = service.buildAuthorizationUrl(state, codeVerifier)

      expect(url).to.include(`${basePath}${authorizationUri}`)
      expect(url).to.include(`client_id=${clientId}`)
      expect(url).to.include('response_type=code')
      expect(url).to.include('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback')
      expect(url).to.include('scope=read+write')
      expect(url).to.include(`state=${state}`)
      expect(url).to.include('code_challenge_method=S256')
      expect(url).to.include('code_challenge=')
    })
  })

  describe('exchangeCodeForToken', () => {
    it('should exchange authorization code for access token', async () => {
      const code = 'auth-code-123'
      const codeVerifier = 'test-verifier'

      const returnedAccessToken = 'access-token-123'
      const returnedRefreshToken = 'refresh-token-456'
      const returnedTokenType = 'Bearer'

      nock(basePath)
        .post(tokenUri, {
          client_id: clientId,
          client_secret: 'test-client-secret',
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: 'http://localhost:3000/callback',
        })
        .reply(200, {
          access_token: returnedAccessToken,
          expires_in: 3600,
          refresh_token: returnedRefreshToken,
          token_type: returnedTokenType,
        })

      const token = await service.exchangeCodeForToken(code, codeVerifier)

      expect(token.accessToken).to.equal(returnedAccessToken)
      expect(token.refreshToken).to.equal(returnedRefreshToken)
      expect(token.tokenType).to.equal(returnedTokenType)
      expect(token.isValid()).to.be.true
    })

    it('should throw error on failed token exchange', async () => {
      nock('https://auth.example.com').post('/oauth/token').reply(400, {error: 'invalid_grant'})

      try {
        await service.exchangeCodeForToken('invalid-code', 'verifier')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
      }
    })
  })

  describe('refreshToken', () => {
    it('should refresh access token using refresh token', async () => {
      const refreshToken = 'refresh-token-456'

      nock(basePath)
        .post(tokenUri, {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        })
        .reply(200, {
          access_token: 'new-access-token',
          expires_in: 3600,
          refresh_token: 'new-refresh-token',
          token_type: 'Bearer',
        })

      const token = await service.refreshToken(refreshToken)

      expect(token.accessToken).to.equal('new-access-token')
      expect(token.refreshToken).to.equal('new-refresh-token')
    })
  })
})
