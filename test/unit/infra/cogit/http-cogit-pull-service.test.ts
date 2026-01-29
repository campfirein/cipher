/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {HttpCogitPullService} from '../../../../src/infra/cogit/http-cogit-pull-service.js'

describe('HttpCogitPullService', () => {
  const config = {
    apiBaseUrl: 'https://dev-beta-cogit.byterover.dev/api/v1',
    timeout: 25,
  }

  let service: HttpCogitPullService

  const basePullParams = {
    branch: 'main',
    sessionKey: 'session-key',
    spaceId: 'space-456',
    teamId: 'team-123',
  }

  const validApiResponse = {
    author: {
      email: 'john@example.com',
      name: 'John Doe',
      when: '2025-11-17T10:00:00Z',
    },
    branch: 'main',
    commit_sha: 'abc123def456',
    files: [
      {
        content: 'SGVsbG8gV29ybGQ=', // "Hello World" in base64
        mode: '100644',
        path: '/structure/context.md',
        sha: '95d09f2b10159347eece71399a7e2e907ea3df4f',
        size: 11,
      },
    ],
    message: 'Latest commit message',
  }

  beforeEach(() => {
    service = new HttpCogitPullService(config)
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('pull()', () => {
    describe('successful responses', () => {
      it('should return CogitSnapshot on success', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .reply(200, validApiResponse)

        const result = await service.pull(basePullParams)

        expect(result.branch).to.equal('main')
        expect(result.commitSha).to.equal('abc123def456')
        expect(result.message).to.equal('Latest commit message')
        expect(result.files).to.have.lengthOf(1)
        expect(result.author.email).to.equal('john@example.com')
      })

      it('should correctly parse files from response', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .reply(200, validApiResponse)

        const result = await service.pull(basePullParams)

        expect(result.files[0].path).to.equal('/structure/context.md')
        expect(result.files[0].content).to.equal('SGVsbG8gV29ybGQ=')
        expect(result.files[0].decodeContent()).to.equal('Hello World')
        expect(result.files[0].size).to.equal(11)
        expect(result.files[0].mode).to.equal('100644')
      })

      it('should handle empty files array', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .reply(200, {
            ...validApiResponse,
            files: [],
          })

        const result = await service.pull(basePullParams)

        expect(result.files).to.have.lengthOf(0)
      })

      it('should handle multiple files', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .reply(200, {
            ...validApiResponse,
            files: [
              validApiResponse.files[0],
              {
                content: 'dGVzdA==',
                mode: '100644',
                path: '/design/context.md',
                sha: 'def456',
                size: 4,
              },
              {
                content: 'Y29kZQ==',
                mode: '100644',
                path: '/code_style/context.md',
                sha: 'ghi789',
                size: 4,
              },
            ],
          })

        const result = await service.pull(basePullParams)

        expect(result.files).to.have.lengthOf(3)
        expect(result.files[0].path).to.equal('/structure/context.md')
        expect(result.files[1].path).to.equal('/design/context.md')
        expect(result.files[2].path).to.equal('/code_style/context.md')
      })
    })

    describe('authentication headers', () => {
      it('should send correct Authorization and session headers', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .matchHeader('x-byterover-session-id', 'my-session-key')
          .reply(200, validApiResponse)

        await service.pull({
          ...basePullParams,
          sessionKey: 'my-session-key',
        })

        expect(nock.isDone()).to.be.true
      })
    })

    describe('URL path construction', () => {
      it('should use correct URL path with teamId and spaceId', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/org-999/projects/proj-888/git/snapshot')
          .query({branch: 'main'})
          .reply(200, validApiResponse)

        await service.pull({
          ...basePullParams,
          spaceId: 'proj-888',
          teamId: 'org-999',
        })

        expect(nock.isDone()).to.be.true
      })

      it('should include branch as query parameter', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'develop'})
          .reply(200, validApiResponse)

        await service.pull({
          ...basePullParams,
          branch: 'develop',
        })

        expect(nock.isDone()).to.be.true
      })

      it('should URL-encode branch name with special characters', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'feature/my-branch'})
          .reply(200, validApiResponse)

        await service.pull({
          ...basePullParams,
          branch: 'feature/my-branch',
        })

        expect(nock.isDone()).to.be.true
      })
    })

    describe('error handling', () => {
      it('should handle HTTP 401 unauthorized error', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .reply(401, {
            message: 'Unauthorized',
            success: false,
          })

        try {
          await service.pull(basePullParams)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Failed to pull from CoGit')
        }
      })

      it('should handle HTTP 404 not found error', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .reply(404, {
            message: 'Space not found',
            success: false,
          })

        try {
          await service.pull(basePullParams)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Failed to pull from CoGit')
        }
      })

      it('should handle HTTP 500 internal server error', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .reply(500, {
            message: 'Internal server error',
            success: false,
          })

        try {
          await service.pull(basePullParams)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Failed to pull from CoGit')
        }
      })

      it('should handle network errors', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .replyWithError('Network timeout')

        try {
          await service.pull(basePullParams)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Failed to pull from CoGit')
        }
      })

      it('should handle invalid JSON response', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .reply(200, {invalid: 'response'})

        try {
          await service.pull(basePullParams)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Failed to pull from CoGit')
        }
      })
    })

    describe('configuration', () => {
      it('should use default timeout when not specified', () => {
        const serviceWithDefaultTimeout = new HttpCogitPullService({
          apiBaseUrl: 'https://example.com/api/v1',
        })

        // Service should be created without error
        expect(serviceWithDefaultTimeout).to.be.instanceOf(HttpCogitPullService)
      })

      it('should use custom timeout when specified', async () => {
        const customTimeoutService = new HttpCogitPullService({
          apiBaseUrl: 'https://dev-beta-cogit.byterover.dev/api/v1',
          timeout: 5000,
        })

        nock('https://dev-beta-cogit.byterover.dev')
          .get('/api/v1/organizations/team-123/projects/space-456/git/snapshot')
          .query({branch: 'main'})
          .reply(200, validApiResponse)

        const result = await customTimeoutService.pull(basePullParams)

        expect(result.branch).to.equal('main')
      })
    })
  })
})
