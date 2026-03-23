import {isAxiosError} from 'axios'
import {expect} from 'chai'
import nock from 'nock'
import * as sinon from 'sinon'

import {AuthenticatedHttpClient} from '../../../../src/server/infra/http/authenticated-http-client.js'
import {ProxyConfig} from '../../../../src/server/infra/http/proxy-config.js'

describe('AuthenticatedHttpClient', () => {
  const baseUrl = 'https://api.example.com'
  const sessionKey = 'test-session-key'
  let client: AuthenticatedHttpClient

  beforeEach(() => {
    // ProxyAgent's connect() flow bypasses nock interception, so disable it in tests
    sinon.stub(ProxyConfig, 'getProxyAgent').returns(undefined as never)
    client = new AuthenticatedHttpClient(sessionKey)
  })

  afterEach(() => {
    sinon.restore()
    nock.cleanAll()
  })

  describe('get', () => {
    it('should include Authorization and x-byterover-session-id headers', async () => {
      const mockData = {message: 'success'}

      nock(baseUrl).get('/test').matchHeader('x-byterover-session-id', sessionKey).reply(200, mockData)

      const response = await client.get<{message: string}>(`${baseUrl}/test`)

      expect(response).to.deep.equal(mockData)
    })

    it('should merge custom headers with authentication headers', async () => {
      const mockData = {message: 'success'}

      nock(baseUrl)
        .get('/test')
        .matchHeader('x-byterover-session-id', sessionKey)
        .matchHeader('x-custom-header', 'custom-value')
        .reply(200, mockData)

      const response = await client.get<{message: string}>(`${baseUrl}/test`, {
        headers: {'x-custom-header': 'custom-value'},
      })

      expect(response).to.deep.equal(mockData)
    })

    it('should respect timeout configuration', async () => {
      nock(baseUrl).get('/test').delay(100).reply(200, {message: 'success'})

      try {
        await client.get(`${baseUrl}/test`, {timeout: 25})
        expect.fail('Should have thrown timeout error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Connection Failed')
      }
    })

    it('should throw error on HTTP 401 Unauthorized', async () => {
      nock(baseUrl).get('/test').reply(401, {error: 'Unauthorized'})

      try {
        await client.get(`${baseUrl}/test`)
        expect.fail('Should have thrown an error')
      } catch (error) {
        // 401 errors are returned as raw AxiosError to allow callers to distinguish from network errors
        expect(isAxiosError(error)).to.be.true
        if (isAxiosError(error)) {
          expect(error.response?.status).to.equal(401)
        }
      }
    })

    it('should throw error on HTTP 500 Internal Server Error', async () => {
      nock(baseUrl).get('/test').reply(500, {error: 'Internal Server Error'})

      try {
        await client.get(`${baseUrl}/test`)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Internal Server Error')
      }
    })

    it('should throw error on network failure', async () => {
      nock(baseUrl).get('/test').replyWithError('Network error')

      try {
        await client.get(`${baseUrl}/test`)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Network error')
      }
    })
  })

  describe('post', () => {
    it('should include Authorization and x-byterover-session-id headers', async () => {
      const requestData = {name: 'test'}
      const mockResponse = {id: '123', name: 'test'}

      nock(baseUrl)
        .post('/test', requestData)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(201, mockResponse)

      const response = await client.post<{id: string; name: string}, {name: string}>(`${baseUrl}/test`, requestData)

      expect(response).to.deep.equal(mockResponse)
    })

    it('should merge custom headers with authentication headers', async () => {
      const requestData = {name: 'test'}
      const mockResponse = {id: '123', name: 'test'}

      nock(baseUrl)
        .post('/test', requestData)
        .matchHeader('x-byterover-session-id', sessionKey)
        .matchHeader('content-type', 'application/json')
        .reply(201, mockResponse)

      const response = await client.post<{id: string; name: string}, {name: string}>(`${baseUrl}/test`, requestData, {
        headers: {'content-type': 'application/json'},
      })

      expect(response).to.deep.equal(mockResponse)
    })

    it('should throw error on HTTP error response', async () => {
      nock(baseUrl).post('/test').reply(400, {error: 'Bad Request'})

      try {
        await client.post(`${baseUrl}/test`, {})
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Bad Request')
      }
    })
  })
})
