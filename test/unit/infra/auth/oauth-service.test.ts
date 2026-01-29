/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'
import {restore} from 'sinon'

import {OAuthConfig} from '../../../../src/config/auth.config.js'
import {NETWORK_ERROR_CODE, OAuthService} from '../../../../src/infra/auth/oauth-service.js'

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

  describe('initiateAuthorization', () => {
    it('should return authorization context with valid URL and state', () => {
      const redirectUri = 'http://localhost:3000/callback'

      const context = service.initiateAuthorization(redirectUri)

      // Verify context structure
      expect(context).to.have.property('authUrl')
      expect(context).to.have.property('state')

      // Verify authUrl contains required OAuth parameters
      expect(context.authUrl).to.include(`${basePath}${authorizationUri}`)
      expect(context.authUrl).to.include(`client_id=${clientId}`)
      expect(context.authUrl).to.include('response_type=code')
      expect(context.authUrl).to.include('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback')
      expect(context.authUrl).to.include('scope=read+write')
      expect(context.authUrl).to.include(`state=${context.state}`)
      expect(context.authUrl).to.include('code_challenge_method=S256')
      expect(context.authUrl).to.include('code_challenge=')
    })

    it('should generate cryptographically secure state', () => {
      const redirectUri = 'http://localhost:3000/callback'

      const context = service.initiateAuthorization(redirectUri)

      // State should be a non-empty string with reasonable length
      expect(context.state).to.be.a('string')
      expect(context.state.length).to.be.greaterThan(16)
    })

    it('should generate unique state for each invocation', () => {
      const redirectUri = 'http://localhost:3000/callback'

      const context1 = service.initiateAuthorization(redirectUri)
      const context2 = service.initiateAuthorization(redirectUri)

      // Each invocation should generate a unique state
      expect(context1.state).to.not.equal(context2.state)
    })

    it('should use parameter redirectUri in authorization URL', () => {
      const parameterRedirectUri = 'http://localhost:4567/callback'

      const context = service.initiateAuthorization(parameterRedirectUri)

      expect(context.authUrl).to.include('redirect_uri=http%3A%2F%2Flocalhost%3A4567%2Fcallback')
      expect(context.authUrl).not.to.include('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback')
    })
  })

  describe('exchangeCodeForToken', () => {
    it('should exchange authorization code for access token using context', async () => {
      const code = 'auth-code-123'
      const redirectUri = 'http://localhost:3000/callback'

      // First, initiate authorization to get context
      const context = service.initiateAuthorization(redirectUri)

      const returnedAccessToken = 'access-token-123'
      const returnedRefreshToken = 'refresh-token-456'
      const returnedTokenType = 'Bearer'

      // Mock the token endpoint - the service should use the code_verifier it generated internally
      nock(basePath)
        .post(tokenUri, (body) => {
          // Verify the request contains a code_verifier (we don't know the exact value since it's internal)
          expect(body).to.have.property('code_verifier')
          expect(body.code_verifier).to.be.a('string')
          expect(body.code_verifier.length).to.be.greaterThan(0)
          expect(body.client_id).to.equal(clientId)
          expect(body.code).to.equal(code)
          expect(body.grant_type).to.equal('authorization_code')
          expect(body.redirect_uri).to.equal(redirectUri)
          return true
        })
        .reply(200, {
          access_token: returnedAccessToken,
          expires_in: 3600,
          refresh_token: returnedRefreshToken,
          session_key: 'session-oauth-123',
          token_type: returnedTokenType,
        })

      const tokenData = await service.exchangeCodeForToken(code, context, redirectUri)

      expect(tokenData.accessToken).to.equal(returnedAccessToken)
      expect(tokenData.refreshToken).to.equal(returnedRefreshToken)
      expect(tokenData.tokenType).to.equal(returnedTokenType)
      expect(tokenData.sessionKey).to.equal('session-oauth-123')
    })

    it('should use correct code_verifier for the given context', async () => {
      const redirectUri = 'http://localhost:3000/callback'

      // Create two different authorization contexts
      const context1 = service.initiateAuthorization(redirectUri)
      const context2 = service.initiateAuthorization(redirectUri)

      // Verify they have different states (and thus different code_verifiers)
      expect(context1.state).to.not.equal(context2.state)

      // Mock token exchange for context1
      let capturedVerifier1: string | undefined
      nock(basePath)
        .post(tokenUri, (body) => {
          capturedVerifier1 = body.code_verifier
          return true
        })
        .reply(200, {
          access_token: 'token1',
          expires_in: 3600,
          refresh_token: 'refresh1',
          session_key: 'session-oauth-context1',
          token_type: 'Bearer',
        })

      await service.exchangeCodeForToken('code1', context1, redirectUri)

      // Mock token exchange for context2
      let capturedVerifier2: string | undefined
      nock(basePath)
        .post(tokenUri, (body) => {
          capturedVerifier2 = body.code_verifier
          return true
        })
        .reply(200, {
          access_token: 'token2',
          expires_in: 3600,
          refresh_token: 'refresh2',
          session_key: 'session-oauth-context2',
          token_type: 'Bearer',
        })

      await service.exchangeCodeForToken('code2', context2, redirectUri)

      // Verify different code_verifiers were used
      expect(capturedVerifier1).to.be.a('string')
      expect(capturedVerifier2).to.be.a('string')
      expect(capturedVerifier1).to.not.equal(capturedVerifier2)
    })

    it('should use parameter redirectUri in token exchange', async () => {
      const code = 'auth-code-123'
      const parameterRedirectUri = 'http://localhost:4567/callback'

      const context = service.initiateAuthorization(parameterRedirectUri)

      nock(basePath)
        .post(tokenUri, (body) => {
          expect(body.redirect_uri).to.equal(parameterRedirectUri)
          return true
        })
        .reply(200, {
          access_token: 'access-token',
          expires_in: 3600,
          refresh_token: 'refresh-token',
          session_key: 'session-oauth-param-redirect',
          token_type: 'Bearer',
        })

      const tokenData = await service.exchangeCodeForToken(code, context, parameterRedirectUri)

      expect(tokenData).to.not.be.undefined
      expect(tokenData.accessToken).to.equal('access-token')
    })

    it('should throw error on failed token exchange', async () => {
      const redirectUri = 'http://localhost:3000/callback'
      const context = service.initiateAuthorization(redirectUri)

      nock('https://auth.example.com').post('/oauth/token').reply(400, {error: 'invalid_grant'})

      try {
        await service.exchangeCodeForToken('invalid-code', context, redirectUri)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
      }
    })

    it('should throw error when using context from different service instance', async () => {
      const redirectUri = 'http://localhost:3000/callback'

      // Create context with one service instance
      const context = service.initiateAuthorization(redirectUri)

      // Create a new service instance
      const otherService = new OAuthService(config)

      nock(basePath).post(tokenUri).reply(200, {
        access_token: 'access-token',
        expires_in: 3600,
        refresh_token: 'refresh-token',
        session_key: 'session-oauth-other-instance',
        token_type: 'Bearer',
      })

      try {
        // Try to use context with different service instance
        await otherService.exchangeCodeForToken('auth-code', context, redirectUri)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('code_verifier')
      }
    })

    it('should throw error when reusing same context (single-use verifier)', async () => {
      const redirectUri = 'http://localhost:3000/callback'
      const context = service.initiateAuthorization(redirectUri)

      // First exchange succeeds
      nock(basePath).post(tokenUri).reply(200, {
        access_token: 'access-token',
        expires_in: 3600,
        refresh_token: 'refresh-token',
        session_key: 'session-key',
        token_type: 'Bearer'
      })

      await service.exchangeCodeForToken('code', context, redirectUri)

      // Second exchange with same context should fail (verifier deleted after first use)
      try {
        await service.exchangeCodeForToken('code2', context, redirectUri)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('code_verifier not found')
      }
    })

    it('should calculate expiresAt correctly from expires_in', async () => {
      const redirectUri = 'http://localhost:3000/callback'
      const expiresIn = 3600 // 1 hour in seconds
      const beforeRequest = Date.now()

      const context = service.initiateAuthorization(redirectUri)

      nock(basePath).post(tokenUri).reply(200, {
        access_token: 'access-token',
        expires_in: expiresIn,
        refresh_token: 'refresh-token',
        session_key: 'session-key',
        token_type: 'Bearer'
      })

      const tokenData = await service.exchangeCodeForToken('code', context, redirectUri)

      const afterRequest = Date.now()
      const expectedMinExpiry = beforeRequest + expiresIn * 1000
      const expectedMaxExpiry = afterRequest + expiresIn * 1000

      expect(tokenData.expiresAt.getTime()).to.be.at.least(expectedMinExpiry)
      expect(tokenData.expiresAt.getTime()).to.be.at.most(expectedMaxExpiry)
    })

    it(`should throw AuthenticationError with user-friendly message for ${NETWORK_ERROR_CODE.ENOTFOUND}`, async () => {
      const redirectUri = 'http://localhost:3000/callback'
      const context = service.initiateAuthorization(redirectUri)

      const err = new Error(`err with code ${NETWORK_ERROR_CODE.ENOTFOUND}`)
      Object.assign(err, {code: NETWORK_ERROR_CODE.ENOTFOUND})
      nock(basePath).post(tokenUri).replyWithError(err)

      try {
        await service.exchangeCodeForToken('code', context, redirectUri)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.equal('Unable to reach authentication server. Please check your internet connection.')
      }
    })

    it(`should throw AuthenticationError with user-friendly message for ${NETWORK_ERROR_CODE.ETIMEDOUT}`, async () => {
      const redirectUri = 'http://localhost:3000/callback'
      const context = service.initiateAuthorization(redirectUri)
      const err = new Error(`err with code ${NETWORK_ERROR_CODE.ETIMEDOUT}`)
      Object.assign(err, {code: NETWORK_ERROR_CODE.ETIMEDOUT})
      nock(basePath).post(tokenUri).replyWithError(err)

      try {
        await service.exchangeCodeForToken('code', context, redirectUri)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.equal('Login timed out. Please check your internet connection and try again.')
      }
    })

    it(`should throw AuthenticationError with user-friendly message for ${NETWORK_ERROR_CODE.ECONNREFUSED}`, async () => {
      const redirectUri = 'http://localhost:3000/callback'
      const context = service.initiateAuthorization(redirectUri)
      const err = new Error(`err with code ${NETWORK_ERROR_CODE.ECONNREFUSED}`)
      Object.assign(err, {code: NETWORK_ERROR_CODE.ECONNREFUSED})
      nock(basePath).post(tokenUri).replyWithError(err)

      try {
        await service.exchangeCodeForToken('code', context, redirectUri)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.equal('Unable to reach authentication server. Please try again later.')
      }
    })

    it(`should throw AuthenticationError with user-friendly message for ${NETWORK_ERROR_CODE.ERR_NETWORK}`, async () => {
      const redirectUri = 'http://localhost:3000/callback'
      const context = service.initiateAuthorization(redirectUri)
      const err = new Error(`err with code ${NETWORK_ERROR_CODE.ERR_NETWORK}`)
      Object.assign(err, {code: NETWORK_ERROR_CODE.ERR_NETWORK})
      nock(basePath).post(tokenUri).replyWithError(err)

      try {
        await service.exchangeCodeForToken('code', context, redirectUri)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.equal('Network error occurred. Please check your internet connection and try again.')
      }
    })

    it('should throw AuthenticationError with generic message for unknown network errors', async () => {
      const redirectUri = 'http://localhost:3000/callback'
      const context = service.initiateAuthorization(redirectUri)
      const err = new Error('generic network error')
      Object.assign(err, {code: 'UNKNOWN_ERROR'})
      nock(basePath).post(tokenUri).replyWithError(err)

      try {
        await service.exchangeCodeForToken('code', context, redirectUri)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.equal('Login failed. Please check your internet connection and try again.')
      }
    })

    it('should throw AuthenticationError with error_description from response', async () => {
      const redirectUri = 'http://localhost:3000/callback'
      const context = service.initiateAuthorization(redirectUri)
      const errDescription = 'Authorization code has expired.'
      nock(basePath).post(tokenUri).reply(400, {
        error: 'invalid_grant',
        error_description: errDescription
      })

      try {
        await service.exchangeCodeForToken('code', context, redirectUri)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.equal(errDescription)
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
          session_key: 'session-oauth-refreshed',
          token_type: 'Bearer',
        })

      const tokenData = await service.refreshToken(refreshToken)

      expect(tokenData.accessToken).to.equal('new-access-token')
      expect(tokenData.refreshToken).to.equal('new-refresh-token')
      expect(tokenData.sessionKey).to.equal('session-oauth-refreshed')
    })

    it('should throw AuthenticationError on network failure', async () => {
      const err = new Error(`err with code ${NETWORK_ERROR_CODE.ECONNREFUSED}`)
      Object.assign(err, {code: NETWORK_ERROR_CODE.ECONNREFUSED})
      nock(basePath).post(tokenUri).replyWithError(err)

      try {
        await service.refreshToken('refresh-token')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.equal('Unable to reach authentication server. Please try again later.')
      }
    })

    it('should throw AuthenticationError with error_description from response', async () => {
      const errDescription = 'Refresh token has expired'
      nock(basePath).post(tokenUri).reply(400, {
        error: 'invalid_grant',
        error_description: errDescription,
      })

      try {
        await service.refreshToken('expired-refresh-token')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.equal(errDescription)
      }
    })
  })
})
