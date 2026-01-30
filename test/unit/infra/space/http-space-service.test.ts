/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {Space} from '../../../../src/core/domain/entities/space.js'
import {HttpSpaceService} from '../../../../src/infra/space/http-space-service.js'

describe('HttpSpaceService', () => {
  const apiBaseUrl = 'https://api.example.com'
  const sessionKey = 'test-session-key'
  const teamId = 'team-1'
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
        .query({team_id: teamId})
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.getSpaces(sessionKey, teamId)

      expect(result.spaces).to.have.lengthOf(2)
      expect(result.total).to.equal(2)
      expect(result.spaces[0]).to.be.instanceOf(Space)
      expect(result.spaces[0].id).to.equal('space-1')
      expect(result.spaces[0].name).to.equal('frontend-app')
      expect(result.spaces[0].teamId).to.equal('team-1')
      expect(result.spaces[0].teamName).to.equal('acme-corp')
      expect(result.spaces[0].getDisplayName()).to.equal('acme-corp/frontend-app')

      expect(result.spaces[1]).to.be.instanceOf(Space)
      expect(result.spaces[1].id).to.equal('space-2')
      expect(result.spaces[1].name).to.equal('backend-api')
      expect(result.spaces[1].teamId).to.equal('team-2')
      expect(result.spaces[1].teamName).to.equal('personal')
      expect(result.spaces[1].getDisplayName()).to.equal('personal/backend-api')
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
        .query({team_id: teamId})
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.getSpaces(sessionKey, teamId)

      expect(result.spaces).to.have.lengthOf(0)
      expect(result.total).to.equal(0)
    })

    it('should throw error on HTTP 401 Unauthorized', async () => {
      nock(apiBaseUrl)
        .get('/spaces')
        .query({team_id: teamId})
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(401, {error: 'Unauthorized'})

      try {
        await service.getSpaces(sessionKey, teamId)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('401')
      }
    })

    it('should throw error on HTTP 500 Internal Server Error', async () => {
      nock(apiBaseUrl)
        .get('/spaces')
        .query({team_id: teamId})
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(500, {error: 'Internal Server Error'})

      try {
        await service.getSpaces(sessionKey, teamId)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('500')
        expect((error as Error).message).to.include('Internal Server Error')
      }
    })

    it('should throw error on network failure', async () => {
      nock(apiBaseUrl).get('/spaces').query({team_id: teamId}).replyWithError('Network error')

      try {
        await service.getSpaces(sessionKey, teamId)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Network error')
      }
    })

    describe('pagination', () => {
      it('should fetch spaces with limit parameter', async () => {
        const mockResponse = {
          code: 200,
          data: {
            spaces: [
              {
                created_at: '2024-01-01T00:00:00Z',
                id: 'space-1',
                name: 'frontend-app',
                status: 'active',
                team: {name: 'acme-corp'},
                team_id: 'team-1',
                updated_at: '2024-01-01T00:00:00Z',
                visibility: 'private',
              },
            ],
            total: 10,
          },
          message: 'success',
        }

        nock(apiBaseUrl)
          .get('/spaces')
          .query({limit: '5', team_id: teamId})
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, mockResponse)

        const result = await service.getSpaces(sessionKey, teamId, {limit: 5})

        expect(result.spaces).to.have.lengthOf(1)
        expect(result.total).to.equal(10)
      })

      it('should fetch spaces with offset parameter', async () => {
        const mockResponse = {
          code: 200,
          data: {
            spaces: [
              {
                created_at: '2024-01-01T00:00:00Z',
                id: 'space-6',
                name: 'backend-api',
                status: 'active',
                team: {name: 'personal'},
                team_id: 'team-2',
                updated_at: '2024-01-01T00:00:00Z',
                visibility: 'public',
              },
            ],
            total: 10,
          },
          message: 'success',
        }

        nock(apiBaseUrl)
          .get('/spaces')
          .query({offset: '5', team_id: teamId})
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, mockResponse)

        const result = await service.getSpaces(sessionKey, teamId, {offset: 5})

        expect(result.spaces).to.have.lengthOf(1)
        expect(result.total).to.equal(10)
      })

      it('should fetch spaces with both limit and offset parameters', async () => {
        const mockResponse = {
          code: 200,
          data: {
            spaces: [
              {
                created_at: '2024-01-01T00:00:00Z',
                id: 'space-11',
                name: 'mobile-app',
                status: 'active',
                team: {name: 'acme-corp'},
                team_id: 'team-1',
                updated_at: '2024-01-01T00:00:00Z',
                visibility: 'private',
              },
            ],
            total: 50,
          },
          message: 'success',
        }

        nock(apiBaseUrl)
          .get('/spaces')
          .query({limit: '10', offset: '10', team_id: teamId})
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, mockResponse)

        const result = await service.getSpaces(sessionKey, teamId, {limit: 10, offset: 10})

        expect(result.spaces).to.have.lengthOf(1)
        expect(result.total).to.equal(50)
      })

      it('should fetch all spaces with fetchAll option', async () => {
        // First page
        nock(apiBaseUrl)
          .get('/spaces')
          .query({limit: '100', offset: '0', team_id: teamId})
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, {
            code: 200,
            data: {
              // eslint-disable-next-line max-nested-callbacks
              spaces: Array.from({length: 100}, (_, i) => ({
                created_at: '2024-01-01T00:00:00Z',
                id: `space-${i + 1}`,
                name: `space-${i + 1}`,
                status: 'active',
                team: {name: 'acme-corp'},
                team_id: 'team-1',
                updated_at: '2024-01-01T00:00:00Z',
                visibility: 'private',
              })),
              total: 127,
            },
            message: 'success',
          })

        // Second page
        nock(apiBaseUrl)
          .get('/spaces')
          .query({limit: '100', offset: '100', team_id: teamId})
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, {
            code: 200,
            data: {
              // eslint-disable-next-line max-nested-callbacks
              spaces: Array.from({length: 27}, (_, i) => ({
                created_at: '2024-01-01T00:00:00Z',
                id: `space-${i + 101}`,
                name: `space-${i + 101}`,
                status: 'active',
                team: {name: 'acme-corp'},
                team_id: 'team-1',
                updated_at: '2024-01-01T00:00:00Z',
                visibility: 'private',
              })),
              total: 127,
            },
            message: 'success',
          })

        const result = await service.getSpaces(sessionKey, teamId, {fetchAll: true})

        expect(result.spaces).to.have.lengthOf(127)
        expect(result.total).to.equal(127)
        expect(result.spaces[0].id).to.equal('space-1')
        expect(result.spaces[126].id).to.equal('space-127')
      })

      it('should stop fetching when all spaces are retrieved', async () => {
        // First and only page (less than page size)
        nock(apiBaseUrl)
          .get('/spaces')
          .query({limit: '100', offset: '0', team_id: teamId})
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, {
            code: 200,
            data: {
              // eslint-disable-next-line max-nested-callbacks
              spaces: Array.from({length: 50}, (_, i) => ({
                created_at: '2024-01-01T00:00:00Z',
                id: `space-${i + 1}`,
                name: `space-${i + 1}`,
                status: 'active',
                team: {name: 'acme-corp'},
                team_id: 'team-1',
                updated_at: '2024-01-01T00:00:00Z',
                visibility: 'private',
              })),
              total: 50,
            },
            message: 'success',
          })

        const result = await service.getSpaces(sessionKey, teamId, {fetchAll: true})

        expect(result.spaces).to.have.lengthOf(50)
        expect(result.total).to.equal(50)
      })
    })
  })
})
