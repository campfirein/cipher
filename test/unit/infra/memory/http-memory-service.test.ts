/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {HttpMemoryService} from '../../../../src/infra/memory/http-memory-service.js'

describe('HttpMemoryService', () => {
  const apiBaseUrl = 'https://api.example.com'
  const accessToken = 'test-access-token'
  const sessionKey = 'test-session-key'
  const spaceId = 'a0000000-b001-0000-0000-000000000000'
  const query = 'what is the best practices applied to this project?'
  const config = {
    apiBaseUrl: 'https://dev-beta-cogit.byterover.dev/api/v1',
    timeout: 5000,
  }

  let service: HttpMemoryService

  beforeEach(() => {
    service = new HttpMemoryService({apiBaseUrl})
  })

  afterEach(() => {
    nock.cleanAll()
  })

  describe('retrieve', () => {
    it('should retrieve memories successfully with all parameters', async () => {
      const mockResponse = {
        memories: [
          {
            children_ids: [],
            content: 'First memory content',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
            node_keys: ['path1', 'path2'],
            parent_ids: ['parent1'],
            score: 0.85,
            title: 'First Memory',
          },
        ],
        related_memories: [
          {
            children_ids: ['child1'],
            content: 'Related memory content',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b68',
            node_keys: ['path3'],
            parent_ids: [],
            score: 0.5,
            title: 'Related Memory',
          },
        ],
      }

      nock(apiBaseUrl)
        .get('/retrieve')
        .query({
          node_keys: 'path1,path2',
          project_id: spaceId,
          query,
        })
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        accessToken,
        nodeKeys: ['path1', 'path2'],
        query,
        sessionKey,
        spaceId,
      })

      expect(result.memories).to.have.lengthOf(1)
      expect(result.relatedMemories).to.have.lengthOf(1)

      // Verify first memory
      expect(result.memories[0].id).to.equal(mockResponse.memories[0].id)
      expect(result.memories[0].title).to.equal(mockResponse.memories[0].title)
      expect(result.memories[0].content).to.equal(mockResponse.memories[0].content)
      expect(result.memories[0].score).to.equal(mockResponse.memories[0].score)
      expect(result.memories[0].nodeKeys).to.deep.equal(mockResponse.memories[0].node_keys)
      expect(result.memories[0].parentIds).to.deep.equal(mockResponse.memories[0].parent_ids)
      expect(result.memories[0].childrenIds).to.deep.equal(mockResponse.memories[0].children_ids)

      // Verify related memory
      expect(result.relatedMemories[0].id).to.equal(mockResponse.related_memories[0].id)
      expect(result.relatedMemories[0].title).to.equal(mockResponse.related_memories[0].title)
      expect(result.relatedMemories[0].childrenIds).to.deep.equal(mockResponse.related_memories[0].children_ids)
    })

    it('should retrieve memories successfully without node-keys (broad search)', async () => {
      const mockResponse = {
        memories: [
          {
            children_ids: [],
            content: 'Memory content',
            id: '019a1e9f-a5ec-7046-956d-27cdff4b6b67',
            node_keys: [],
            parent_ids: [],
            score: 0.75,
            title: 'Memory Title',
          },
        ],
        related_memories: [],
      }

      nock(apiBaseUrl)
        .get('/retrieve')
        .query({
          project_id: spaceId,
          query,
        })
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        accessToken,
        query,
        sessionKey,
        spaceId,
      })

      expect(result.memories).to.have.lengthOf(1)
      expect(result.relatedMemories).to.have.lengthOf(0)
    })

    it('should return empty results when no memories found', async () => {
      const mockResponse = {
        memories: [],
        related_memories: [],
      }

      nock(apiBaseUrl)
        .get('/retrieve')
        .query({
          project_id: spaceId,
          query,
        })
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(200, mockResponse)

      const result = await service.retrieve({
        accessToken,
        query,
        sessionKey,
        spaceId,
      })

      expect(result.memories).to.deep.equal([])
      expect(result.relatedMemories).to.deep.equal([])
    })

    it('should map spaceId to project_id query parameter', async () => {
      const mockResponse = {
        memories: [],
        related_memories: [],
      }

      const scope = nock(apiBaseUrl)
        .get('/retrieve')
        .query((actualQuery) => {
          // Verify that spaceId is sent as project_id
          expect(actualQuery.project_id).to.equal(spaceId)
          return true
        })
        .reply(200, mockResponse)

      await service.retrieve({
        accessToken,
        query,
        sessionKey,
        spaceId,
      })

      expect(scope.isDone()).to.be.true
    })

    it('should convert nodeKeys array to comma-separated node_keys query parameter', async () => {
      const mockResponse = {
        memories: [],
        related_memories: [],
      }

      const scope = nock(apiBaseUrl)
        .get('/retrieve')
        .query((actualQuery) => {
          // Verify that nodeKeys array is converted to comma-separated string
          expect(actualQuery.node_keys).to.equal('path1,path2,path3')
          return true
        })
        .reply(200, mockResponse)

      await service.retrieve({
        accessToken,
        nodeKeys: ['path1', 'path2', 'path3'],
        query,
        sessionKey,
        spaceId,
      })

      expect(scope.isDone()).to.be.true
    })

    it('should omit node_keys parameter when nodeKeys not provided', async () => {
      const mockResponse = {
        memories: [],
        related_memories: [],
      }

      const scope = nock(apiBaseUrl)
        .get('/retrieve')
        .query((actualQuery) => {
          // Verify that node_keys is NOT present in query
          expect(actualQuery.node_keys).to.be.undefined
          return true
        })
        .reply(200, mockResponse)

      await service.retrieve({
        accessToken,
        query,
        sessionKey,
        spaceId,
      })

      expect(scope.isDone()).to.be.true
    })

    it('should throw error on HTTP 401 Unauthorized', async () => {
      nock(apiBaseUrl)
        .get('/retrieve')
        .query(true)
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(401, {error: 'Unauthorized'})

      try {
        await service.retrieve({
          accessToken,
          query,
          sessionKey,
          spaceId,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to retrieve memories')
        expect((error as Error).message).to.include('401')
      }
    })

    it('should throw error on HTTP 404 Not Found', async () => {
      nock(apiBaseUrl)
        .get('/retrieve')
        .query(true)
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(404, {error: 'Not found'})

      try {
        await service.retrieve({
          accessToken,
          query,
          sessionKey,
          spaceId,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to retrieve memories')
        expect((error as Error).message).to.include('404')
      }
    })

    it('should throw error on HTTP 500 Internal Server Error', async () => {
      nock(apiBaseUrl)
        .get('/retrieve')
        .query(true)
        .matchHeader('authorization', `Bearer ${accessToken}`)
        .matchHeader('x-byterover-session-id', sessionKey)
        .reply(500, {error: 'Internal Server Error'})

      try {
        await service.retrieve({
          accessToken,
          query,
          sessionKey,
          spaceId,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to retrieve memories')
        expect((error as Error).message).to.include('500')
      }
    })

    it('should throw error on network failure', async () => {
      nock(apiBaseUrl).get('/retrieve').query(true).replyWithError('Network error')

      try {
        await service.retrieve({
          accessToken,
          query,
          sessionKey,
          spaceId,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to retrieve memories')
        expect((error as Error).message).to.include('Network error')
      }
    })

    it('should throw error on request timeout', async () => {
      nock(apiBaseUrl).get('/retrieve').query(true).delay(35_000).reply(200, {})

      const timeoutService = new HttpMemoryService({apiBaseUrl, timeout: 100})

      try {
        await timeoutService.retrieve({
          accessToken,
          query,
          sessionKey,
          spaceId,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('Failed to retrieve memories')
      }
    })
  })

  describe('getPresignedUrls()', () => {
    it('should return presigned URLs response for valid request', async () => {
      const mockResponse = {
        data: {
          presigned_urls: [
            {
              file_name: 'playbook.json',
              presigned_url: 'https://storage.googleapis.com/bucket/path?signature=abc',
            },
          ],
          request_id: 'req-123',
        },
        message: 'Success',
        success: true,
      }

      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/presigned-urls')
        .matchHeader('authorization', 'Bearer access-token')
        .matchHeader('x-byterover-session-id', 'session-key')
        .reply(200, mockResponse)

      const service = new HttpMemoryService(config)
      const result = await service.getPresignedUrls({
        accessToken: 'access-token',
        branch: 'main',
        fileNames: ['playbook.json'],
        sessionKey: 'session-key',
        spaceId: 'space-456',
        teamId: 'team-123',
      })

      expect(result.presignedUrls).to.have.lengthOf(1)
      expect(result.presignedUrls[0].fileName).to.equal('playbook.json')
      expect(result.presignedUrls[0].uploadUrl).to.include('storage.googleapis.com')
      expect(result.requestId).to.equal('req-123')
    })

    it('should handle multiple files', async () => {
      const mockResponse = {
        data: {
          presigned_urls: [
            {
              file_name: 'file1.md',
              presigned_url: 'https://storage.googleapis.com/bucket/file1?sig=abc',
            },
            {
              file_name: 'file2.md',
              presigned_url: 'https://storage.googleapis.com/bucket/file2?sig=def',
            },
          ],
          request_id: 'req-456',
        },
        message: 'Success',
        success: true,
      }

      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/presigned-urls')
        .reply(200, mockResponse)

      const service = new HttpMemoryService(config)
      const result = await service.getPresignedUrls({
        accessToken: 'access-token',
        branch: 'main',
        fileNames: ['file1.md', 'file2.md'],
        sessionKey: 'session-key',
        spaceId: 'space-456',
        teamId: 'team-123',
      })

      expect(result.presignedUrls).to.have.lengthOf(2)
      expect(result.presignedUrls[0].fileName).to.equal('file1.md')
      expect(result.presignedUrls[1].fileName).to.equal('file2.md')
      expect(result.requestId).to.equal('req-456')
    })

    it('should send correct request body', async () => {
      let capturedBody: unknown

      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/presigned-urls')

        .reply(200, (_uri, requestBody) => {
          capturedBody = requestBody
          return {
            data: {
              presigned_urls: [{file_name: 'file1.md', presigned_url: 'https://storage.googleapis.com/url1'}],
              request_id: 'req-789',
            },
            message: 'Success',
            success: true,
          }
        })

      const service = new HttpMemoryService(config)
      await service.getPresignedUrls({
        accessToken: 'access-token',
        branch: 'develop',
        fileNames: ['file1.md', 'file2.md'],
        sessionKey: 'session-key',
        spaceId: 'space-456',
        teamId: 'team-123',
      })

      expect(capturedBody).to.deep.equal({
        branch: 'develop',
        file_names: ['file1.md', 'file2.md'],
      })
    })

    it('should handle network errors', async () => {
      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/presigned-urls')
        .replyWithError('Network timeout')

      const service = new HttpMemoryService(config)

      try {
        await service.getPresignedUrls({
          accessToken: 'access-token',
          branch: 'main',
          fileNames: ['playbook.json'],
          sessionKey: 'session-key',
          spaceId: 'space-456',
          teamId: 'team-123',
        })
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to get presigned URLs')
      }
    })

    it('should handle HTTP error responses', async () => {
      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/presigned-urls')
        .reply(404, {message: 'Space not found', success: false})

      const service = new HttpMemoryService(config)

      try {
        await service.getPresignedUrls({
          accessToken: 'access-token',
          branch: 'main',
          fileNames: ['playbook.json'],
          sessionKey: 'session-key',
          spaceId: 'space-456',
          teamId: 'team-123',
        })
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to get presigned URLs')
      }
    })
  })

  describe('uploadFile()', () => {
    const uploadUrl = 'https://storage.googleapis.com/bucket/path?signature=abc123'
    const fileContent = '{"bullets": {}, "sections": {}, "nextId": 1}'

    it('should upload file content to presigned URL', async () => {
      nock('https://storage.googleapis.com').put('/bucket/path?signature=abc123', fileContent).reply(200)

      const service = new HttpMemoryService(config)
      await service.uploadFile(uploadUrl, fileContent)

      expect(nock.isDone()).to.be.true
    })

    it('should set Content-Type header to application/json', async () => {
      nock('https://storage.googleapis.com')
        .put('/bucket/path?signature=abc123')
        .matchHeader('content-type', 'application/json')
        .reply(200)

      const service = new HttpMemoryService(config)
      await service.uploadFile(uploadUrl, fileContent)

      expect(nock.isDone()).to.be.true
    })

    it('should handle network errors', async () => {
      nock('https://storage.googleapis.com').put('/bucket/path?signature=abc123').replyWithError('Network error')

      const service = new HttpMemoryService(config)

      try {
        await service.uploadFile(uploadUrl, fileContent)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to upload file')
      }
    })

    it('should handle timeout errors', async () => {
      nock('https://storage.googleapis.com')
        .put('/bucket/path?signature=abc123')
        .delay(6000) // Delay longer than 5s timeout
        .reply(200)

      const service = new HttpMemoryService(config)

      try {
        await service.uploadFile(uploadUrl, fileContent)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to upload file')
      }
    })

    it('should handle HTTP 403 (expired/invalid signature)', async () => {
      nock('https://storage.googleapis.com')
        .put('/bucket/path?signature=abc123')
        .reply(403, {error: 'SignatureDoesNotMatch'})

      const service = new HttpMemoryService(config)

      try {
        await service.uploadFile(uploadUrl, fileContent)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to upload file')
      }
    })

    it('should upload valid JSON content', async () => {
      const jsonContent = JSON.stringify({
        bullets: {
          'test-00001': {
            content: 'Test bullet',
            id: 'test-00001',
            metadata: {tags: [], timestamp: '2025-01-01'},
            section: 'Test',
          },
        },
        nextId: 2,
        sections: {Test: ['test-00001']},
      })

      nock('https://storage.googleapis.com').put('/bucket/path?signature=abc123', jsonContent).reply(200)

      const service = new HttpMemoryService(config)
      await service.uploadFile(uploadUrl, jsonContent)

      expect(nock.isDone()).to.be.true
    })
  })

  describe('confirmUpload()', () => {
    it('should confirm upload successfully', async () => {
      const mockResponse = {
        data: {
          message: 'Upload confirmed successfully and notification sent',
          request_id: 'req-123',
          status: 'uploaded',
        },
        message: 'Upload confirmed successfully',
        success: true,
      }

      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/confirm-upload')
        .matchHeader('authorization', 'Bearer access-token')
        .matchHeader('x-byterover-session-id', 'session-key')
        .reply(200, mockResponse)

      const service = new HttpMemoryService(config)
      await service.confirmUpload({
        accessToken: 'access-token',
        requestId: 'req-123',
        sessionKey: 'session-key',
        spaceId: 'space-456',
        teamId: 'team-123',
      })

      expect(nock.isDone()).to.be.true
    })

    it('should send correct request body', async () => {
      let capturedBody: unknown

      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/confirm-upload')
        .reply(200, (_uri, requestBody) => {
          capturedBody = requestBody
          return {
            data: {message: 'Upload confirmed', request_id: 'req-456', status: 'uploaded'},
            message: 'Success',
            success: true,
          }
        })

      const service = new HttpMemoryService(config)
      await service.confirmUpload({
        accessToken: 'access-token',
        requestId: 'req-456',
        sessionKey: 'session-key',
        spaceId: 'space-456',
        teamId: 'team-123',
      })

      expect(capturedBody).to.deep.equal({
        request_id: 'req-456',
      })
    })

    it('should send correct headers', async () => {
      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/confirm-upload')
        .matchHeader('authorization', 'Bearer test-token-789')
        .matchHeader('x-byterover-session-id', 'test-session-789')
        .reply(200, {
          data: {message: 'Upload confirmed', request_id: 'req-789', status: 'uploaded'},
          message: 'Success',
          success: true,
        })

      const service = new HttpMemoryService(config)
      await service.confirmUpload({
        accessToken: 'test-token-789',
        requestId: 'req-789',
        sessionKey: 'test-session-789',
        spaceId: 'space-456',
        teamId: 'team-123',
      })

      expect(nock.isDone()).to.be.true
    })

    it('should use correct URL path', async () => {
      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/org-999/projects/proj-888/memory-processing/confirm-upload')
        .reply(200, {
          data: {message: 'Upload confirmed', request_id: 'req-001', status: 'uploaded'},
          message: 'Success',
          success: true,
        })

      const service = new HttpMemoryService(config)
      await service.confirmUpload({
        accessToken: 'access-token',
        requestId: 'req-001',
        sessionKey: 'session-key',
        spaceId: 'proj-888',
        teamId: 'org-999',
      })

      expect(nock.isDone()).to.be.true
    })

    it('should handle network errors', async () => {
      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/confirm-upload')
        .replyWithError('Network timeout')

      const service = new HttpMemoryService(config)

      try {
        await service.confirmUpload({
          accessToken: 'access-token',
          requestId: 'req-123',
          sessionKey: 'session-key',
          spaceId: 'space-456',
          teamId: 'team-123',
        })
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to confirm upload')
      }
    })

    it('should handle HTTP 404 errors', async () => {
      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/confirm-upload')
        .reply(404, {message: 'Request not found', success: false})

      const service = new HttpMemoryService(config)

      try {
        await service.confirmUpload({
          accessToken: 'access-token',
          requestId: 'req-unknown',
          sessionKey: 'session-key',
          spaceId: 'space-456',
          teamId: 'team-123',
        })
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to confirm upload')
      }
    })

    it('should handle HTTP 500 errors', async () => {
      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/confirm-upload')
        .reply(500, {message: 'Internal server error', success: false})

      const service = new HttpMemoryService(config)

      try {
        await service.confirmUpload({
          accessToken: 'access-token',
          requestId: 'req-123',
          sessionKey: 'session-key',
          spaceId: 'space-456',
          teamId: 'team-123',
        })
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).to.be.an('error')
        expect((error as Error).message).to.include('Failed to confirm upload')
      }
    })
  })
})
