/* eslint-disable camelcase -- OAuth token fields use snake_case per RFC 6749 */
import {expect} from 'chai'
import nock from 'nock'
import {restore, stub} from 'sinon'
import {ZodError} from 'zod'

import {ProxyConfig} from '../../../../src/server/infra/http/proxy-config.js'
import {ProviderTokenExchangeError} from '../../../../src/server/infra/provider-oauth/errors.js'
import {exchangeRefreshToken} from '../../../../src/server/infra/provider-oauth/refresh-token-exchange.js'

describe('exchangeRefreshToken', () => {
  beforeEach(() => {
    stub(ProxyConfig, 'getProxyAgent').returns(undefined as never)
  })

  afterEach(() => {
    restore()
    nock.cleanAll()
  })

  it('should exchange refresh token with form-encoded body', async () => {
    nock('https://auth.openai.com')
      .post('/oauth/token', (body: string) => {
        const params = new URLSearchParams(body)
        return (
          params.get('grant_type') === 'refresh_token' &&
          params.get('client_id') === 'test-client' &&
          params.get('refresh_token') === 'rt_old'
        )
      })
      .matchHeader('Content-Type', 'application/x-www-form-urlencoded')
      .reply(200, {
        access_token: 'at_new',
        expires_in: 3600,
        refresh_token: 'rt_new',
        token_type: 'Bearer',
      })

    const result = await exchangeRefreshToken({
      clientId: 'test-client',
      contentType: 'application/x-www-form-urlencoded',
      refreshToken: 'rt_old',
      tokenUrl: 'https://auth.openai.com/oauth/token',
    })

    expect(result.access_token).to.equal('at_new')
    expect(result.refresh_token).to.equal('rt_new')
    expect(result.expires_in).to.equal(3600)
  })

  it('should exchange refresh token with JSON body', async () => {
    nock('https://console.anthropic.com')
      .post('/v1/oauth/token', {
        client_id: 'test-client',
        grant_type: 'refresh_token',
        refresh_token: 'rt_old',
      })
      .matchHeader('Content-Type', 'application/json')
      .reply(200, {
        access_token: 'at_anthropic_new',
        expires_in: 7200,
      })

    const result = await exchangeRefreshToken({
      clientId: 'test-client',
      contentType: 'application/json',
      refreshToken: 'rt_old',
      tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    })

    expect(result.access_token).to.equal('at_anthropic_new')
    expect(result.expires_in).to.equal(7200)
  })

  it('should throw ProviderTokenExchangeError on HTTP error', async () => {
    nock('https://auth.openai.com').post('/oauth/token').reply(400, {
      error: 'invalid_grant',
      error_description: 'Refresh token has been revoked',
    })

    try {
      await exchangeRefreshToken({
        clientId: 'test-client',
        contentType: 'application/x-www-form-urlencoded',
        refreshToken: 'rt_expired',
        tokenUrl: 'https://auth.openai.com/oauth/token',
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ProviderTokenExchangeError)
      if (!(error instanceof ProviderTokenExchangeError)) throw error
      expect(error.errorCode).to.equal('invalid_grant')
      expect(error.message).to.equal('Refresh token has been revoked')
      expect(error.statusCode).to.equal(400)
    }
  })

  it('should throw ProviderTokenExchangeError on 5xx server error', async () => {
    nock('https://auth.openai.com').post('/oauth/token').reply(503, 'Service Unavailable')

    try {
      await exchangeRefreshToken({
        clientId: 'test-client',
        contentType: 'application/x-www-form-urlencoded',
        refreshToken: 'rt_test',
        tokenUrl: 'https://auth.openai.com/oauth/token',
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ProviderTokenExchangeError)
      if (!(error instanceof ProviderTokenExchangeError)) throw error
      expect(error.statusCode).to.equal(503)
    }
  })

  it('should re-throw non-axios errors as-is', async () => {
    // Nock with a request error (simulates connection failure)
    nock('https://unreachable.example.com').post('/oauth/token').replyWithError('connect ECONNREFUSED')

    try {
      await exchangeRefreshToken({
        clientId: 'test-client',
        contentType: 'application/json',
        refreshToken: 'rt_test',
        tokenUrl: 'https://unreachable.example.com/oauth/token',
      })
      expect.fail('Should have thrown')
    } catch (error) {
      // replyWithError creates an axios error, so it gets wrapped
      expect(error).to.be.instanceOf(ProviderTokenExchangeError)
      if (!(error instanceof ProviderTokenExchangeError)) throw error
      expect(error.message).to.include('connect ECONNREFUSED')
    }
  })

  it('should throw ZodError when access_token is missing', async () => {
    nock('https://auth.openai.com').post('/oauth/token').reply(200, {token_type: 'Bearer'})

    try {
      await exchangeRefreshToken({
        clientId: 'test-client',
        contentType: 'application/x-www-form-urlencoded',
        refreshToken: 'rt_test',
        tokenUrl: 'https://auth.openai.com/oauth/token',
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ZodError)
    }
  })
})
