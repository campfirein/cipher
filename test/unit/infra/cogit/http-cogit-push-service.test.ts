/* eslint-disable max-nested-callbacks */
/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {CogitPushContext} from '../../../../src/server/core/domain/entities/cogit-push-context.js'
import {HttpCogitPushService} from '../../../../src/server/infra/cogit/http-cogit-push-service.js'

const createContext = (
  overrides: Partial<{content: string; operation: 'add'; path: string; tags: string[]; title: string}> = {},
) =>
  new CogitPushContext({
    content: overrides.content ?? 'Test content',
    operation: overrides.operation ?? 'add',
    path: overrides.path ?? 'structure/context.md',
    tags: overrides.tags ?? [],
    title: overrides.title ?? 'Test Title',
  })

describe('HttpCogitPushService', () => {
  const config = {
    apiBaseUrl: 'https://dev-beta-cogit.byterover.dev/api/v1',
    timeout: 25,
  }

  let service: HttpCogitPushService

  const basePushParams = {
    accessToken: 'access-token',
    branch: 'main',
    contexts: [createContext()],
    sessionKey: 'session-key',
    spaceId: 'space-456',
    teamId: 'team-123',
  }

  beforeEach(() => {
    service = new HttpCogitPushService(config)
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('push()', () => {
    describe('two-request SHA flow', () => {
      it('should succeed on first request if no SHA error', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(200, {
            commit_sha: 'abc123def456',
            message: 'Commit successful',
            success: true,
          })

        const result = await service.push(basePushParams)

        expect(result.success).to.equal(true)
        expect(result.message).to.equal('Commit successful')
      })

      it('should send empty current_sha on first request', async () => {
        let capturedBody: unknown

        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(200, (_uri, requestBody) => {
            capturedBody = requestBody
            return {
              commit_sha: 'abc123',
              message: 'Success',
              success: true,
            }
          })

        await service.push(basePushParams)

        expect((capturedBody as Record<string, unknown>).current_sha).to.equal('sha_placeholder')
      })

      it('should retry with extracted SHA when first request fails with SHA error', async () => {
        const requestBodies: unknown[] = []

        // First request fails with SHA error
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(400, (_uri, body) => {
            requestBodies.push(body)
            return {
              error: "Expected SHA 'abc123' but current SHA is 'def456789abcdef'",
              message: 'SHA mismatch',
              success: false,
            }
          })

        // Second request succeeds
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(200, (_uri, body) => {
            requestBodies.push(body)
            return {
              commit_sha: 'newsha789',
              message: 'Commit successful',
              success: true,
            }
          })

        const result = await service.push(basePushParams)

        expect(result.success).to.equal(true)

        // Verify first request had placeholder SHA
        expect((requestBodies[0] as Record<string, unknown>).current_sha).to.equal('sha_placeholder')

        // Verify second request used extracted SHA
        expect((requestBodies[1] as Record<string, unknown>).current_sha).to.equal('def456789abcdef')
      })

      it('should throw error if SHA cannot be extracted from error response', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(400, {
            message: 'Some other error without SHA details',
            success: false,
          })

        try {
          await service.push(basePushParams)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Failed to push to CoGit')
        }
      })

      it('should throw error if second request fails', async () => {
        // First request fails with SHA error
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(400, {
            error: "Expected SHA 'xxx' but current SHA is 'abc123'",
            message: 'SHA mismatch',
            success: false,
          })

        // Second request also fails
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(500, {
            message: 'Internal server error',
            success: false,
          })

        try {
          await service.push(basePushParams)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Failed to push to CoGit')
        }
      })
    })

    describe('request body structure', () => {
      it('should send correct snake_case request body', async () => {
        let capturedBody: unknown

        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(200, (_uri, requestBody) => {
            capturedBody = requestBody
            return {
              commit_sha: 'abc123',
              message: 'Success',
              success: true,
            }
          })

        await service.push({
          ...basePushParams,
          branch: 'develop',
          contexts: [
            createContext({
              content: 'My content here',
              path: 'design/context.md',
              tags: ['tag1', 'tag2'],
              title: 'Design Guide',
            }),
          ],
        })

        expect(capturedBody).to.deep.equal({
          branch: 'develop',
          current_sha: 'sha_placeholder',
          memories: [
            {
              content: 'My content here',
              operation: 'add',
              path: 'design/context.md',
              tags: ['tag1', 'tag2'],
              title: 'Design Guide',
            },
          ],
        })
      })

      it('should send multiple contexts as memories array', async () => {
        let capturedBody: unknown

        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(200, (_uri, requestBody) => {
            capturedBody = requestBody
            return {
              commit_sha: 'abc123',
              message: 'Success',
              success: true,
            }
          })

        await service.push({
          ...basePushParams,
          contexts: [
            createContext({path: 'file1.md', title: 'File 1'}),
            createContext({path: 'file2.md', title: 'File 2'}),
            createContext({path: 'file3.md', title: 'File 3'}),
          ],
        })

        const body = capturedBody as Record<string, unknown>
        expect((body.memories as unknown[]).length).to.equal(3)
      })
    })

    describe('authentication headers', () => {
      it('should send correct Authorization and session headers', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .matchHeader('x-byterover-session-id', 'my-session-key')
          .reply(200, {
            commit_sha: 'abc123',
            message: 'Success',
            success: true,
          })

        await service.push({
          ...basePushParams,
          accessToken: 'my-access-token',
          sessionKey: 'my-session-key',
        })

        expect(nock.isDone()).to.be.true
      })
    })

    describe('URL path construction', () => {
      it('should use correct URL path with teamId and spaceId', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/org-999/projects/proj-888/commits')
          .reply(200, {
            commit_sha: 'abc123',
            message: 'Success',
            success: true,
          })

        await service.push({
          ...basePushParams,
          spaceId: 'proj-888',
          teamId: 'org-999',
        })

        expect(nock.isDone()).to.be.true
      })
    })

    describe('error handling', () => {
      it('should handle HTTP 401 unauthorized error', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(401, {
            message: 'Unauthorized',
            success: false,
          })

        try {
          await service.push(basePushParams)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Failed to push to CoGit')
        }
      })

      it('should handle HTTP 404 not found error', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(404, {
            message: 'Space not found',
            success: false,
          })

        try {
          await service.push(basePushParams)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Failed to push to CoGit')
        }
      })

      it('should handle network errors', async () => {
        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .replyWithError('Network timeout')

        try {
          await service.push(basePushParams)
          expect.fail('Should have thrown error')
        } catch (error) {
          expect(error).to.be.an('error')
          expect((error as Error).message).to.include('Failed to push to CoGit')
        }
      })
    })

    describe('SHA extraction patterns', () => {
      it('should extract SHA from standard error format', async () => {
        const requestBodies: unknown[] = []

        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(400, (_uri, body) => {
            requestBodies.push(body)
            return {
              error: "Expected SHA '' but current SHA is 'a1b2c3d4e5f6'",
              message: 'SHA mismatch',
              success: false,
            }
          })

        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(200, (_uri, body) => {
            requestBodies.push(body)
            return {
              commit_sha: 'newsha',
              message: 'Success',
              success: true,
            }
          })

        await service.push(basePushParams)

        expect((requestBodies[1] as Record<string, unknown>).current_sha).to.equal('a1b2c3d4e5f6')
      })

      it('should handle case-insensitive SHA extraction', async () => {
        const requestBodies: unknown[] = []

        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(400, (_uri, body) => {
            requestBodies.push(body)
            return {
              error: "Current SHA IS 'ABCDEF123456'",
              message: 'SHA mismatch',
              success: false,
            }
          })

        nock('https://dev-beta-cogit.byterover.dev')
          .post('/api/v1/organizations/team-123/projects/space-456/commits')
          .reply(200, (_uri, body) => {
            requestBodies.push(body)
            return {
              commit_sha: 'newsha',
              message: 'Success',
              success: true,
            }
          })

        await service.push(basePushParams)

        // SHA extracted should preserve the case from the error message
        expect((requestBodies[1] as Record<string, unknown>).current_sha).to.equal('ABCDEF123456')
      })
    })
  })
})
