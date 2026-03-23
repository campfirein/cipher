/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'
import * as sinon from 'sinon'

import {ProxyConfig} from '../../../../src/server/infra/http/proxy-config.js'
import {HttpMemoryStorageService} from '../../../../src/server/infra/memory/http-memory-storage-service.js'

describe('HttpMemoryStorageService', () => {
  const config = {
    apiBaseUrl: 'https://dev-beta-cogit.byterover.dev/api/v1',
    timeout: 25,
  }

  let service: HttpMemoryStorageService

  beforeEach(() => {
    sinon.stub(ProxyConfig, 'getProxyAgent').returns(undefined as never)
    service = new HttpMemoryStorageService(config)
  })

  afterEach(() => {
    sinon.restore()
    nock.cleanAll()
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
        .matchHeader('x-byterover-session-id', 'session-key')
        .reply(200, mockResponse)

      const result = await service.getPresignedUrls({
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

      const result = await service.getPresignedUrls({
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

      await service.getPresignedUrls({
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

      try {
        await service.getPresignedUrls({
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

      try {
        await service.getPresignedUrls({
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

      await service.uploadFile(uploadUrl, fileContent)

      expect(nock.isDone()).to.be.true
    })

    it('should set Content-Type header to application/json', async () => {
      nock('https://storage.googleapis.com')
        .put('/bucket/path?signature=abc123')
        .matchHeader('content-type', 'application/json')
        .reply(200)

      await service.uploadFile(uploadUrl, fileContent)

      expect(nock.isDone()).to.be.true
    })

    it('should handle network errors', async () => {
      nock('https://storage.googleapis.com').put('/bucket/path?signature=abc123').replyWithError('Network error')

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
        .delay(200) // Delay longer than 100ms timeout
        .reply(200)

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
        .matchHeader('x-byterover-session-id', 'session-key')
        .reply(200, mockResponse)

      await service.confirmUpload({
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

      await service.confirmUpload({
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
        .matchHeader('x-byterover-session-id', 'test-session-789')
        .reply(200, {
          data: {message: 'Upload confirmed', request_id: 'req-789', status: 'uploaded'},
          message: 'Success',
          success: true,
        })

      await service.confirmUpload({
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

      await service.confirmUpload({
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

      try {
        await service.confirmUpload({
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

      try {
        await service.confirmUpload({
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

      try {
        await service.confirmUpload({
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
