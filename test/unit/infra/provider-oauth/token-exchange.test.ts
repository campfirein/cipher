/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'
import {restore, stub} from 'sinon'
import {ZodError} from 'zod'

import type {TokenExchangeParams} from '../../../../src/server/infra/provider-oauth/types.js'

import {ProxyConfig} from '../../../../src/server/infra/http/proxy-config.js'
import {ProviderTokenExchangeError} from '../../../../src/server/infra/provider-oauth/errors.js'
import {exchangeCodeForTokens} from '../../../../src/server/infra/provider-oauth/token-exchange.js'

describe('exchangeCodeForTokens', () => {
  const basePath = 'https://provider.example.com'
  const tokenPath = '/oauth/token'
  const tokenUrl = `${basePath}${tokenPath}`

  const baseParams: TokenExchangeParams = {
    clientId: 'test-client-id',
    code: 'auth-code-123',
    codeVerifier: 'test-code-verifier',
    contentType: 'application/x-www-form-urlencoded',
    redirectUri: 'http://localhost:1455/auth/callback',
    tokenUrl,
  }

  const tokenResponse = {
    access_token: 'access-token-123',
    expires_in: 3600,
    id_token: 'id-token-456',
    refresh_token: 'refresh-token-789',
    scope: 'openid profile',
    token_type: 'Bearer',
  }

  beforeEach(() => {
    stub(ProxyConfig, 'getProxyAgent').returns(undefined as never)
  })

  afterEach(() => {
    nock.cleanAll()
    restore()
  })

  describe('with application/x-www-form-urlencoded content type', () => {
    it('should POST form-urlencoded body to token URL', async () => {
      let capturedBody: Record<string, string> | undefined
      nock(basePath)
        .post(tokenPath, (body: Record<string, string>) => {
          capturedBody = body
          return true
        })
        .reply(200, tokenResponse)

      await exchangeCodeForTokens(baseParams)

      expect(capturedBody).to.not.be.undefined
      expect(capturedBody?.client_id).to.equal('test-client-id')
      expect(capturedBody?.code).to.equal('auth-code-123')
      expect(capturedBody?.code_verifier).to.equal('test-code-verifier')
      expect(capturedBody?.grant_type).to.equal('authorization_code')
      expect(capturedBody?.redirect_uri).to.equal('http://localhost:1455/auth/callback')
    })

    it('should set Content-Type header to application/x-www-form-urlencoded', async () => {
      nock(basePath)
        .post(tokenPath)
        .matchHeader('Content-Type', 'application/x-www-form-urlencoded')
        .reply(200, tokenResponse)

      await exchangeCodeForTokens(baseParams)
    })

    it('should return the raw token response', async () => {
      nock(basePath).post(tokenPath).reply(200, tokenResponse)

      const result = await exchangeCodeForTokens(baseParams)

      expect(result.access_token).to.equal('access-token-123')
      expect(result.refresh_token).to.equal('refresh-token-789')
      expect(result.id_token).to.equal('id-token-456')
      expect(result.expires_in).to.equal(3600)
      expect(result.token_type).to.equal('Bearer')
      expect(result.scope).to.equal('openid profile')
    })

    it('should include client_secret when provided', async () => {
      let capturedBody: Record<string, string> | undefined
      nock(basePath)
        .post(tokenPath, (body: Record<string, string>) => {
          capturedBody = body
          return true
        })
        .reply(200, tokenResponse)

      await exchangeCodeForTokens({...baseParams, clientSecret: 'my-secret'})

      expect(capturedBody?.client_secret).to.equal('my-secret')
    })

    it('should not include client_secret when undefined', async () => {
      let capturedBody: Record<string, string> | undefined
      nock(basePath)
        .post(tokenPath, (body: Record<string, string>) => {
          capturedBody = body
          return true
        })
        .reply(200, tokenResponse)

      await exchangeCodeForTokens(baseParams)

      expect(capturedBody).to.not.have.property('client_secret')
    })
  })

  describe('with application/json content type', () => {
    const jsonParams: TokenExchangeParams = {
      ...baseParams,
      contentType: 'application/json',
    }

    it('should POST JSON body to token URL', async () => {
      let capturedBody: Record<string, string> | undefined
      nock(basePath)
        .post(tokenPath, (body: Record<string, string>) => {
          capturedBody = body
          return true
        })
        .reply(200, tokenResponse)

      await exchangeCodeForTokens(jsonParams)

      expect(capturedBody?.client_id).to.equal('test-client-id')
      expect(capturedBody?.code).to.equal('auth-code-123')
      expect(capturedBody?.code_verifier).to.equal('test-code-verifier')
      expect(capturedBody?.grant_type).to.equal('authorization_code')
    })

    it('should set Content-Type header to application/json', async () => {
      nock(basePath).post(tokenPath).matchHeader('Content-Type', 'application/json').reply(200, tokenResponse)

      await exchangeCodeForTokens(jsonParams)
    })

    it('should return the raw token response', async () => {
      nock(basePath).post(tokenPath).reply(200, tokenResponse)

      const result = await exchangeCodeForTokens(jsonParams)
      expect(result.access_token).to.equal('access-token-123')
    })
  })

  describe('error handling', () => {
    it('should throw ProviderTokenExchangeError with error_description from response', async () => {
      nock(basePath).post(tokenPath).reply(400, {
        error: 'invalid_grant',
        error_description: 'Authorization code has expired.',
      })

      try {
        await exchangeCodeForTokens(baseParams)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(ProviderTokenExchangeError)
        if (error instanceof ProviderTokenExchangeError) {
          expect(error.message).to.equal('Authorization code has expired.')
          expect(error.errorCode).to.equal('invalid_grant')
          expect(error.statusCode).to.equal(400)
        }
      }
    })

    it('should throw ProviderTokenExchangeError with error code from response', async () => {
      nock(basePath).post(tokenPath).reply(400, {
        error: 'invalid_client',
      })

      try {
        await exchangeCodeForTokens(baseParams)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(ProviderTokenExchangeError)
        if (error instanceof ProviderTokenExchangeError) {
          expect(error.errorCode).to.equal('invalid_client')
        }
      }
    })

    it('should throw ProviderTokenExchangeError with fallback message on network error', async () => {
      const err = new Error('connect ECONNREFUSED')
      Object.assign(err, {code: 'ECONNREFUSED'})
      nock(basePath).post(tokenPath).replyWithError(err)

      try {
        await exchangeCodeForTokens(baseParams)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(ProviderTokenExchangeError)
        if (error instanceof ProviderTokenExchangeError) {
          expect(error.message).to.include('Token exchange failed')
          expect(error.errorCode).to.equal('ECONNREFUSED')
        }
      }
    })

    it('should handle non-JSON error response gracefully', async () => {
      nock(basePath).post(tokenPath).reply(500, '<html>Internal Server Error</html>', {
        'Content-Type': 'text/html',
      })

      try {
        await exchangeCodeForTokens(baseParams)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(ProviderTokenExchangeError)
        if (error instanceof ProviderTokenExchangeError) {
          expect(error.message).to.include('Token exchange failed')
          expect(error.statusCode).to.equal(500)
        }
      }
    })

    it('should throw ZodError when access_token is missing', async () => {
      nock(basePath).post(tokenPath).reply(200, {token_type: 'Bearer'})

      try {
        await exchangeCodeForTokens(baseParams)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(ZodError)
      }
    })

    it('should throw ZodError when access_token is empty', async () => {
      nock(basePath).post(tokenPath).reply(200, {access_token: '', token_type: 'Bearer'})

      try {
        await exchangeCodeForTokens(baseParams)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(ZodError)
      }
    })

    it('should re-throw non-Axios errors', async () => {
      nock(basePath).post(tokenPath).reply(200, tokenResponse)

      // Force a non-Axios error by passing an invalid tokenUrl
      try {
        await exchangeCodeForTokens({...baseParams, tokenUrl: 'not-a-valid-url'})
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.not.be.instanceOf(ProviderTokenExchangeError)
      }
    })
  })
})
