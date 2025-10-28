/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {Team} from '../../../../src/core/domain/entities/team.js'
import {HttpTeamService} from '../../../../src/infra/team/http-team-service.js'

describe('HttpTeamService', () => {
  const apiBaseUrl = 'https://api.example.com'
  const accessToken = 'test-access-token'
  const sessionKey = 'test-session-key'
  let service: HttpTeamService

  beforeEach(() => {
    service = new HttpTeamService({apiBaseUrl})
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('getTeams', () => {
    it('should fetch teams successfully', async () => {
      const mockResponse = {
        code: 200,
        data: {
          limit: 10,
          offset: 0,
          teams: [
            {
              avatar_url: 'https://example.com/avatar1.png',
              created_at: '2024-01-01T00:00:00Z',
              description: 'Team 1 description',
              display_name: 'Acme Corporation',
              id: 'team-1',
              is_active: true,
              name: 'acme-corp',
              updated_at: '2024-01-02T00:00:00Z',
            },
            {
              avatar_url: 'https://example.com/avatar2.png',
              created_at: '2024-01-03T00:00:00Z',
              description: 'Team 2 description',
              display_name: 'Personal Team',
              id: 'team-2',
              is_active: true,
              name: 'personal',
              updated_at: '2024-01-04T00:00:00Z',
            },
          ],
          total: 2,
        },
        message: 'success',
      }

      nock(apiBaseUrl)
        .get('/teams')
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.getTeams(accessToken, sessionKey)

      expect(result.teams).to.have.lengthOf(2)
      expect(result.total).to.equal(2)
      expect(result.teams[0]).to.be.instanceOf(Team)
      expect(result.teams[0].id).to.equal('team-1')
      expect(result.teams[0].name).to.equal('acme-corp')
      expect(result.teams[0].displayName).to.equal('Acme Corporation')
      expect(result.teams[0].description).to.equal('Team 1 description')
      expect(result.teams[0].avatarUrl).to.equal('https://example.com/avatar1.png')
      expect(result.teams[0].isActive).to.equal(true)
      expect(result.teams[0].getDisplayName()).to.equal('Acme Corporation')

      expect(result.teams[1]).to.be.instanceOf(Team)
      expect(result.teams[1].id).to.equal('team-2')
      expect(result.teams[1].name).to.equal('personal')
      expect(result.teams[1].displayName).to.equal('Personal Team')
      expect(result.teams[1].getDisplayName()).to.equal('Personal Team')
    })

    it('should return empty array when no teams exist', async () => {
      const mockResponse = {
        code: 200,
        data: {
          limit: 10,
          offset: 0,
          teams: [],
          total: 0,
        },
        message: 'success',
      }

      nock(apiBaseUrl)
        .get('/teams')
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.getTeams(accessToken, sessionKey)

      expect(result.teams).to.have.lengthOf(0)
      expect(result.total).to.equal(0)
    })

    it('should throw error on HTTP 401 Unauthorized', async () => {
      nock(apiBaseUrl)
        .get('/teams')
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(401, {error: 'Unauthorized'})

      try {
        await service.getTeams(accessToken, sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('401')
        expect((error as Error).message).to.include('Unauthorized')
      }
    })

    it('should throw error on HTTP 500 Internal Server Error', async () => {
      nock(apiBaseUrl)
        .get('/teams')
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(500, {error: 'Internal Server Error'})

      try {
        await service.getTeams(accessToken, sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('500')
        expect((error as Error).message).to.include('Internal Server Error')
      }
    })

    it('should throw error on network failure', async () => {
      nock(apiBaseUrl).get('/teams').replyWithError('Network error')

      try {
        await service.getTeams(accessToken, sessionKey)
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Network error')
      }
    })

    describe('filtering', () => {
      it('should fetch active teams only with isActive filter', async () => {
        const mockResponse = {
          code: 200,
          data: {
            limit: 10,
            offset: 0,
            teams: [
              {
                avatar_url: 'https://example.com/avatar1.png',
                created_at: '2024-01-01T00:00:00Z',
                description: 'Active team',
                display_name: 'Active Team',
                id: 'team-1',
                is_active: true,
                name: 'active-team',
                updated_at: '2024-01-02T00:00:00Z',
              },
            ],
            total: 1,
          },
          message: 'success',
        }

        nock(apiBaseUrl)
          .get('/teams')
          .query({is_active: 'true'})
          .matchHeader('authorization', `Bearer ${accessToken}`)
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, mockResponse)

        const result = await service.getTeams(accessToken, sessionKey, {isActive: true})

        expect(result.teams).to.have.lengthOf(1)
        expect(result.total).to.equal(1)
        expect(result.teams[0].isActive).to.equal(true)
      })

      it('should fetch inactive teams with isActive=false filter', async () => {
        const mockResponse = {
          code: 200,
          data: {
            limit: 10,
            offset: 0,
            teams: [
              {
                avatar_url: '',
                created_at: '2024-01-01T00:00:00Z',
                description: 'Inactive team',
                display_name: 'Inactive Team',
                id: 'team-2',
                is_active: false,
                name: 'inactive-team',
                updated_at: '2024-01-02T00:00:00Z',
              },
            ],
            total: 1,
          },
          message: 'success',
        }

        nock(apiBaseUrl)
          .get('/teams')
          .query({is_active: 'false'})
          .matchHeader('authorization', `Bearer ${accessToken}`)
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, mockResponse)

        const result = await service.getTeams(accessToken, sessionKey, {isActive: false})

        expect(result.teams).to.have.lengthOf(1)
        expect(result.total).to.equal(1)
        expect(result.teams[0].isActive).to.equal(false)
      })
    })

    describe('pagination', () => {
      it('should fetch teams with limit parameter', async () => {
        const mockResponse = {
          code: 200,
          data: {
            limit: 5,
            offset: 0,
            teams: [
              {
                avatar_url: '',
                created_at: '2024-01-01T00:00:00Z',
                description: '',
                display_name: 'Team 1',
                id: 'team-1',
                is_active: true,
                name: 'team-1',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            total: 10,
          },
          message: 'success',
        }

        nock(apiBaseUrl)
          .get('/teams')
          .query({limit: '5'})
          .matchHeader('authorization', `Bearer ${accessToken}`)
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, mockResponse)

        const result = await service.getTeams(accessToken, sessionKey, {limit: 5})

        expect(result.teams).to.have.lengthOf(1)
        expect(result.total).to.equal(10)
      })

      it('should fetch teams with offset parameter', async () => {
        const mockResponse = {
          code: 200,
          data: {
            limit: 10,
            offset: 5,
            teams: [
              {
                avatar_url: '',
                created_at: '2024-01-01T00:00:00Z',
                description: '',
                display_name: 'Team 6',
                id: 'team-6',
                is_active: true,
                name: 'team-6',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            total: 10,
          },
          message: 'success',
        }

        nock(apiBaseUrl)
          .get('/teams')
          .query({offset: '5'})
          .matchHeader('authorization', `Bearer ${accessToken}`)
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, mockResponse)

        const result = await service.getTeams(accessToken, sessionKey, {offset: 5})

        expect(result.teams).to.have.lengthOf(1)
        expect(result.total).to.equal(10)
      })

      it('should fetch teams with both limit and offset parameters', async () => {
        const mockResponse = {
          code: 200,
          data: {
            limit: 10,
            offset: 10,
            teams: [
              {
                avatar_url: '',
                created_at: '2024-01-01T00:00:00Z',
                description: '',
                display_name: 'Team 11',
                id: 'team-11',
                is_active: true,
                name: 'team-11',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            total: 50,
          },
          message: 'success',
        }

        nock(apiBaseUrl)
          .get('/teams')
          .query({limit: '10', offset: '10'})
          .matchHeader('authorization', `Bearer ${accessToken}`)
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, mockResponse)

        const result = await service.getTeams(accessToken, sessionKey, {limit: 10, offset: 10})

        expect(result.teams).to.have.lengthOf(1)
        expect(result.total).to.equal(50)
      })

      it('should combine isActive filter with pagination', async () => {
        const mockResponse = {
          code: 200,
          data: {
            limit: 5,
            offset: 0,
            teams: [
              {
                avatar_url: '',
                created_at: '2024-01-01T00:00:00Z',
                description: '',
                display_name: 'Active Team 1',
                id: 'team-1',
                is_active: true,
                name: 'active-team-1',
                updated_at: '2024-01-01T00:00:00Z',
              },
            ],
            total: 8,
          },
          message: 'success',
        }

        nock(apiBaseUrl)
          .get('/teams')
          .query({is_active: 'true', limit: '5'})
          .matchHeader('authorization', `Bearer ${accessToken}`)
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, mockResponse)

        const result = await service.getTeams(accessToken, sessionKey, {isActive: true, limit: 5})

        expect(result.teams).to.have.lengthOf(1)
        expect(result.total).to.equal(8)
      })

      it('should fetch all teams with fetchAll option', async () => {
        // First page
        nock(apiBaseUrl)
          .get('/teams')
          .query({limit: '100', offset: '0'})
          .matchHeader('authorization', `Bearer ${accessToken}`)
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, {
            code: 200,
            data: {
              limit: 100,
              offset: 0,
              // eslint-disable-next-line max-nested-callbacks
              teams: Array.from({length: 100}, (_, i) => ({
                avatar_url: '',
                created_at: '2024-01-01T00:00:00Z',
                description: '',
                display_name: `Team ${i + 1}`,
                id: `team-${i + 1}`,
                is_active: true,
                name: `team-${i + 1}`,
                updated_at: '2024-01-01T00:00:00Z',
              })),
              total: 127,
            },
            message: 'success',
          })

        // Second page
        nock(apiBaseUrl)
          .get('/teams')
          .query({limit: '100', offset: '100'})
          .matchHeader('authorization', `Bearer ${accessToken}`)
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, {
            code: 200,
            data: {
              limit: 100,
              offset: 100,
              // eslint-disable-next-line max-nested-callbacks
              teams: Array.from({length: 27}, (_, i) => ({
                avatar_url: '',
                created_at: '2024-01-01T00:00:00Z',
                description: '',
                display_name: `Team ${i + 101}`,
                id: `team-${i + 101}`,
                is_active: true,
                name: `team-${i + 101}`,
                updated_at: '2024-01-01T00:00:00Z',
              })),
              total: 127,
            },
            message: 'success',
          })

        const result = await service.getTeams(accessToken, sessionKey, {fetchAll: true})

        expect(result.teams).to.have.lengthOf(127)
        expect(result.total).to.equal(127)
        expect(result.teams[0].id).to.equal('team-1')
        expect(result.teams[126].id).to.equal('team-127')
      })

      it('should stop fetching when all teams are retrieved', async () => {
        // First and only page (less than page size)
        nock(apiBaseUrl)
          .get('/teams')
          .query({limit: '100', offset: '0'})
          .matchHeader('authorization', `Bearer ${accessToken}`)
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, {
            code: 200,
            data: {
              limit: 100,
              offset: 0,
              // eslint-disable-next-line max-nested-callbacks
              teams: Array.from({length: 50}, (_, i) => ({
                avatar_url: '',
                created_at: '2024-01-01T00:00:00Z',
                description: '',
                display_name: `Team ${i + 1}`,
                id: `team-${i + 1}`,
                is_active: true,
                name: `team-${i + 1}`,
                updated_at: '2024-01-01T00:00:00Z',
              })),
              total: 50,
            },
            message: 'success',
          })

        const result = await service.getTeams(accessToken, sessionKey, {fetchAll: true})

        expect(result.teams).to.have.lengthOf(50)
        expect(result.total).to.equal(50)
      })

      it('should fetch all active teams with fetchAll and isActive filter', async () => {
        nock(apiBaseUrl)
          .get('/teams')
          .query({is_active: 'true', limit: '100', offset: '0'})
          .matchHeader('authorization', `Bearer ${accessToken}`)
          .matchHeader('x-byterover-session-id', sessionKey)
          .reply(200, {
            code: 200,
            data: {
              limit: 100,
              offset: 0,
              // eslint-disable-next-line max-nested-callbacks
              teams: Array.from({length: 25}, (_, i) => ({
                avatar_url: '',
                created_at: '2024-01-01T00:00:00Z',
                description: '',
                display_name: `Active Team ${i + 1}`,
                id: `team-${i + 1}`,
                is_active: true,
                name: `active-team-${i + 1}`,
                updated_at: '2024-01-01T00:00:00Z',
              })),
              total: 25,
            },
            message: 'success',
          })

        const result = await service.getTeams(accessToken, sessionKey, {fetchAll: true, isActive: true})

        expect(result.teams).to.have.lengthOf(25)
        expect(result.total).to.equal(25)
        for (const team of result.teams) {
          expect(team.isActive).to.equal(true)
        }
      })
    })
  })
})
