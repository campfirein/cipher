import {isAxiosError} from 'axios'
import {expect} from 'chai'
import nock from 'nock'

import {User} from '../../../../src/server/core/domain/entities/user.js'
import {HttpUserService} from '../../../../src/server/infra/user/http-user-service.js'

describe('HttpUserService', () => {
  const apiBaseUrl = 'https://api.example.com'
  const sessionKey = 'test-session-key'
  let service: HttpUserService

  beforeEach(() => {
    service = new HttpUserService({apiBaseUrl})
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('getCurrentUser', () => {
    it('should fetch user information successfully', async () => {
      const mockResponse = {
        code: 200,
        data: {
          email: 'user@example.com',
          id: 'user-123',
          name: 'John Doe',
        },
        message: 'success',
      }

      nock(apiBaseUrl).get('/user/me').matchHeader('x-byterover-session-id', sessionKey).reply(200, mockResponse)

      const user = await service.getCurrentUser(sessionKey)

      expect(user).to.be.instanceOf(User)
      expect(user.email).to.equal('user@example.com')
      expect(user.id).to.equal('user-123')
      expect(user.name).to.equal('John Doe')
    })

    it('should throw error on HTTP 401 Unauthorized', async () => {
      nock(apiBaseUrl)
        .get('/user/me')
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(401, {error: 'Unauthorized'})

      try {
        await service.getCurrentUser(sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        // 401 errors are returned as raw AxiosError to allow callers to distinguish from network errors
        expect(isAxiosError(error)).to.be.true
        if (isAxiosError(error)) {
          expect(error.response?.status).to.equal(401)
        }
      }
    })

    it('should throw error on HTTP 404 Not Found', async () => {
      nock(apiBaseUrl)
        .get('/user/me')
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(404, {error: 'User not found'})

      try {
        await service.getCurrentUser(sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('User not found')
      }
    })

    it('should throw error on HTTP 500 Internal Server Error', async () => {
      nock(apiBaseUrl)
        .get('/user/me')
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(500, {error: 'Internal Server Error'})

      try {
        await service.getCurrentUser(sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Internal Server Error')
      }
    })

    it('should throw error on network failure', async () => {
      nock(apiBaseUrl).get('/user/me').replyWithError('Network error')

      try {
        await service.getCurrentUser(sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Network error')
      }
    })

    it('should throw error on request timeout', async () => {
      nock(apiBaseUrl).get('/user/me').delayConnection(15_000).reply(200, {})

      const timeoutService = new HttpUserService({apiBaseUrl, timeout: 25})

      try {
        await timeoutService.getCurrentUser(sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Connection Failed')
      }
    })
  })
})
