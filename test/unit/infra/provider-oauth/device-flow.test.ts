/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'
import {restore} from 'sinon'

import {
  exchangeForCopilotToken,
  pollForAccessToken,
  requestDeviceCode,
} from '../../../../src/server/infra/provider-oauth/device-flow.js'
import {ProviderTokenExchangeError} from '../../../../src/server/infra/provider-oauth/errors.js'
import {
  COPILOT_TOKEN_URL,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_OAUTH_TOKEN_URL,
} from '../../../../src/shared/constants/copilot.js'

const GITHUB_BASE = new URL(GITHUB_DEVICE_CODE_URL).origin
const GITHUB_API_BASE = new URL(COPILOT_TOKEN_URL).origin
const DEVICE_CODE_PATH = new URL(GITHUB_DEVICE_CODE_URL).pathname
const OAUTH_TOKEN_PATH = new URL(GITHUB_OAUTH_TOKEN_URL).pathname
const COPILOT_TOKEN_PATH = new URL(COPILOT_TOKEN_URL).pathname

describe('device-flow', () => {
  afterEach(() => {
    nock.cleanAll()
    restore()
  })

  describe('requestDeviceCode()', () => {
    it('successfully requests device code and returns camelCase response', async () => {
      nock(GITHUB_BASE)
        .post(DEVICE_CODE_PATH)
        .reply(200, {
          device_code: 'dev-code-abc',
          expires_in: 900,
          interval: 5,
          user_code: 'USER-CODE',
          verification_uri: 'https://github.com/login/device',
        })

      const result = await requestDeviceCode({clientId: 'test-client', scope: 'read:user'})

      expect(result.deviceCode).to.equal('dev-code-abc')
      expect(result.userCode).to.equal('USER-CODE')
      expect(result.verificationUri).to.equal('https://github.com/login/device')
      expect(result.interval).to.equal(5)
      expect(result.expiresIn).to.equal(900)
    })

    it('throws on HTTP error (422)', async () => {
      nock(GITHUB_BASE).post(DEVICE_CODE_PATH).reply(422, {message: 'Unprocessable Entity'})

      try {
        await requestDeviceCode({clientId: 'bad-client', scope: 'read:user'})
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
      }
    })

    it('sends correct headers and body', async () => {
      let capturedBody: string | undefined

      nock(GITHUB_BASE)
        .post(DEVICE_CODE_PATH, (body: string) => {
          capturedBody = body
          return true
        })
        .matchHeader('Accept', 'application/json')
        .matchHeader('Content-Type', 'application/x-www-form-urlencoded')
        .reply(200, {
          device_code: 'dc',
          expires_in: 900,
          interval: 5,
          user_code: 'UC',
          verification_uri: 'https://github.com/login/device',
        })

      await requestDeviceCode({clientId: 'my-client', scope: 'read:user'})

      const params = new URLSearchParams(capturedBody)
      expect(params.get('client_id')).to.equal('my-client')
      expect(params.get('scope')).to.equal('read:user')
    })
  })

  describe('pollForAccessToken()', () => {
    it('returns access token after authorization_pending then success', async () => {
      nock(GITHUB_BASE)
        .post(OAUTH_TOKEN_PATH)
        .reply(200, {error: 'authorization_pending'})
        .post(OAUTH_TOKEN_PATH)
        .reply(200, {access_token: 'gho_test_token'})

      const token = await pollForAccessToken({
        clientId: 'test-client',
        deviceCode: 'dev-code-abc',
        expiresIn: 900,
        interval: 0,
        intervalBuffer: 0,
      })

      expect(token).to.equal('gho_test_token')
    })

    it('handles slow_down by increasing interval', async () => {
      nock(GITHUB_BASE)
        .post(OAUTH_TOKEN_PATH)
        .reply(200, {error: 'slow_down'})
        .post(OAUTH_TOKEN_PATH)
        .reply(200, {access_token: 'gho_slow_token'})

      await pollForAccessToken({
        clientId: 'test-client',
        deviceCode: 'dev-code-abc',
        expiresIn: 900,
        interval: 0,
        intervalBuffer: 0,
        slowDownIncrement: 0,
      })
    })

    it('throws on expired_token', async () => {
      nock(GITHUB_BASE).post(OAUTH_TOKEN_PATH).reply(200, {error: 'expired_token'})

      try {
        await pollForAccessToken({
          clientId: 'test-client',
          deviceCode: 'dev-code-abc',
          expiresIn: 900,
          interval: 0,
          intervalBuffer: 0,
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        if (error instanceof Error) {
          expect(error.message).to.equal('Device code expired')
        }
      }
    })

    it('throws on access_denied', async () => {
      nock(GITHUB_BASE).post(OAUTH_TOKEN_PATH).reply(200, {error: 'access_denied'})

      try {
        await pollForAccessToken({
          clientId: 'test-client',
          deviceCode: 'dev-code-abc',
          expiresIn: 900,
          interval: 0,
          intervalBuffer: 0,
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        if (error instanceof Error) {
          expect(error.message).to.equal('Authorization denied by user')
        }
      }
    })

    it('throws when AbortSignal is aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      try {
        await pollForAccessToken({
          clientId: 'test-client',
          deviceCode: 'dev-code-abc',
          expiresIn: 900,
          interval: 0,
          signal: controller.signal,
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        if (error instanceof Error) {
          expect(error.message).to.equal('Device flow cancelled')
        }
      }
    })

    it('handles unknown errors with error_description', async () => {
      nock(GITHUB_BASE)
        .post(OAUTH_TOKEN_PATH)
        .reply(200, {error: 'some_unknown_error', error_description: 'Something went wrong'})

      try {
        await pollForAccessToken({
          clientId: 'test-client',
          deviceCode: 'dev-code-abc',
          expiresIn: 900,
          interval: 0,
          intervalBuffer: 0,
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        if (error instanceof Error) {
          expect(error.message).to.equal('Something went wrong')
        }
      }
    })
  })

  describe('exchangeForCopilotToken()', () => {
    it('successfully exchanges GitHub token for Copilot token', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 1800

      nock(GITHUB_API_BASE)
        .get(COPILOT_TOKEN_PATH)
        .reply(200, {
          expires_at: expiresAt,
          token: 'tid=copilot_token_xyz',
        })

      const result = await exchangeForCopilotToken('gho_github_token')

      expect(result.token).to.equal('tid=copilot_token_xyz')
      expect(result.expiresAt).to.equal(expiresAt)
    })

    it('throws ProviderTokenExchangeError with status code on 401', async () => {
      nock(GITHUB_API_BASE).get(COPILOT_TOKEN_PATH).reply(401, {message: 'Bad credentials'})

      try {
        await exchangeForCopilotToken('invalid_token')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(ProviderTokenExchangeError)
        if (error instanceof ProviderTokenExchangeError) {
          expect(error.statusCode).to.equal(401)
        }
      }
    })

    it('throws ProviderTokenExchangeError with status code on 403', async () => {
      nock(GITHUB_API_BASE).get(COPILOT_TOKEN_PATH).reply(403, {error: 'forbidden', error_description: 'No Copilot subscription'})

      try {
        await exchangeForCopilotToken('gho_no_subscription')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(ProviderTokenExchangeError)
        if (error instanceof ProviderTokenExchangeError) {
          expect(error.statusCode).to.equal(403)
          expect(error.message).to.equal('No Copilot subscription')
          expect(error.errorCode).to.equal('forbidden')
        }
      }
    })

    it('re-throws non-axios errors unchanged', async () => {
      nock(GITHUB_API_BASE).get(COPILOT_TOKEN_PATH).replyWithError('socket hang up')

      try {
        await exchangeForCopilotToken('gho_token')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(ProviderTokenExchangeError)
      }
    })

    it('sends correct Authorization header format', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 1800

      nock(GITHUB_API_BASE)
        .get(COPILOT_TOKEN_PATH)
        .matchHeader('Authorization', 'token gho_my_token')
        .matchHeader('Accept', 'application/json')
        .matchHeader('X-GitHub-Api-Version', '2025-04-01')
        .reply(200, {
          expires_at: expiresAt,
          token: 'tid=some_token',
        })

      const result = await exchangeForCopilotToken('gho_my_token')
      expect(result.token).to.equal('tid=some_token')
    })
  })
})
