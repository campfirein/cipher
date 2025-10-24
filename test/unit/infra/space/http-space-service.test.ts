/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {Space} from '../../../../src/core/domain/entities/space.js'
import {HttpSpaceService} from '../../../../src/infra/space/http-space-service.js'

describe('HttpSpaceService', () => {
  const apiBaseUrl = 'https://api.example.com'
  const accessToken = 'test-access-token'
  const sessionKey = 'test-session-key'
  let service: HttpSpaceService

  beforeEach(() => {
    service = new HttpSpaceService({apiBaseUrl})
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('getSpaces', () => {
    it('should fetch spaces successfully', async () => {
      const mockResponse = {
        code: 200,
        data: {
          spaces: [
            {
              created_at: '2024-01-01T00:00:00Z',
              id: 'space-1',
              name: 'frontend-app',
              status: 'active',
              team: {
                avatar_url: 'https://example.com/avatar.png',
                created_at: '2024-01-01T00:00:00Z',
                description: 'Team description',
                display_name: 'Acme Corp',
                id: 'team-1',
                is_active: true,
                name: 'acme-corp',
                updated_at: '2024-01-01T00:00:00Z',
              },
              team_id: 'team-1',
              updated_at: '2024-01-01T00:00:00Z',
              visibility: 'private',
            },
            {
              created_at: '2024-01-02T00:00:00Z',
              id: 'space-2',
              name: 'backend-api',
              status: 'active',
              team: {
                avatar_url: 'https://example.com/avatar2.png',
                created_at: '2024-01-01T00:00:00Z',
                description: 'Team 2 description',
                display_name: 'Personal',
                id: 'team-2',
                is_active: true,
                name: 'personal',
                updated_at: '2024-01-01T00:00:00Z',
              },
              team_id: 'team-2',
              updated_at: '2024-01-02T00:00:00Z',
              visibility: 'public',
            },
          ],
          total: 2,
        },
        message: 'success',
      }

      nock(apiBaseUrl)
        .get('/spaces')
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const spaces = await service.getSpaces(accessToken, sessionKey)

      expect(spaces).to.have.lengthOf(2)
      expect(spaces[0]).to.be.instanceOf(Space)
      expect(spaces[0].id).to.equal('space-1')
      expect(spaces[0].name).to.equal('frontend-app')
      expect(spaces[0].teamId).to.equal('team-1')
      expect(spaces[0].teamName).to.equal('acme-corp')
      expect(spaces[0].getDisplayName()).to.equal('acme-corp/frontend-app')

      expect(spaces[1]).to.be.instanceOf(Space)
      expect(spaces[1].id).to.equal('space-2')
      expect(spaces[1].name).to.equal('backend-api')
      expect(spaces[1].teamId).to.equal('team-2')
      expect(spaces[1].teamName).to.equal('personal')
      expect(spaces[1].getDisplayName()).to.equal('personal/backend-api')
    })

    it('should return empty array when no spaces exist', async () => {
      const mockResponse = {
        code: 200,
        data: {
          spaces: [],
          total: 0,
        },
        message: 'success',
      }

      nock(apiBaseUrl)
        .get('/spaces')
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const spaces = await service.getSpaces(accessToken, sessionKey)

      expect(spaces).to.have.lengthOf(0)
    })

    it('should throw error on HTTP 401 Unauthorized', async () => {
      nock(apiBaseUrl)
        .get('/spaces')
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(401, {error: 'Unauthorized'})

      try {
        await service.getSpaces(accessToken, sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('401')
        expect((error as Error).message).to.include('Unauthorized')
      }
    })

    it('should throw error on HTTP 500 Internal Server Error', async () => {
      nock(apiBaseUrl)
        .get('/spaces')
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(500, {error: 'Internal Server Error'})

      try {
        await service.getSpaces(accessToken, sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('500')
        expect((error as Error).message).to.include('Internal Server Error')
      }
    })

    it('should throw error on network failure', async () => {
      nock(apiBaseUrl).get('/spaces').replyWithError('Network error')

      try {
        await service.getSpaces(accessToken, sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Network error')
      }
    })
  })
})