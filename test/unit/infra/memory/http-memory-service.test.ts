/* eslint-disable camelcase */
import {expect} from 'chai'
import nock from 'nock'

import {HttpMemoryService} from '../../../../src/infra/memory/http-memory-service.js'

describe('HttpMemoryService', () => {
  const config = {
    apiBaseUrl: 'https://dev-beta-cogit.byterover.dev/api/v1',
    timeout: 5000,
  }

  afterEach(() => {
    nock.cleanAll()
  })

  describe('getPresignedUrls()', () => {
    it('should return presigned URLs for valid request', async () => {
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

      expect(result).to.have.lengthOf(1)
      expect(result[0].fileName).to.equal('playbook.json')
      expect(result[0].uploadUrl).to.include('storage.googleapis.com')
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

      expect(result).to.have.lengthOf(2)
      expect(result[0].fileName).to.equal('file1.md')
      expect(result[1].fileName).to.equal('file2.md')
    })

    it('should send correct request body', async () => {
      let capturedBody: unknown

      nock('https://dev-beta-cogit.byterover.dev')
        .post('/api/v1/organizations/team-123/projects/space-456/memory-processing/presigned-urls')

        .reply(200, (_uri, requestBody) => {
          capturedBody = requestBody
          return {
            data: {presigned_urls: [], request_id: 'req-789'},
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
      nock('https://storage.googleapis.com')
        .put('/bucket/path?signature=abc123', fileContent)
        .reply(200)

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
      nock('https://storage.googleapis.com')
        .put('/bucket/path?signature=abc123')
        .replyWithError('Network error')

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

      nock('https://storage.googleapis.com')
        .put('/bucket/path?signature=abc123', jsonContent)
        .reply(200)

      const service = new HttpMemoryService(config)
      await service.uploadFile(uploadUrl, jsonContent)

      expect(nock.isDone()).to.be.true
    })
  })
})
