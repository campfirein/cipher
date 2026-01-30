import {expect} from 'chai'

import {PresignedUrl} from '../../../../../src/server/core/domain/entities/presigned-url.js'
import {PresignedUrlsResponse} from '../../../../../src/server/core/domain/entities/presigned-urls-response.js'

describe('PresignedUrlsResponse', () => {
  describe('constructor', () => {
    it('should create a valid PresignedUrlsResponse', () => {
      const presignedUrls = [
        new PresignedUrl('file1.json', 'https://storage.googleapis.com/bucket/file1?sig=abc'),
        new PresignedUrl('file2.json', 'https://storage.googleapis.com/bucket/file2?sig=def'),
      ]
      const requestId = 'req-123'

      const response = new PresignedUrlsResponse(presignedUrls, requestId)

      expect(response.presignedUrls).to.have.lengthOf(2)
      expect(response.presignedUrls[0].fileName).to.equal('file1.json')
      expect(response.presignedUrls[1].fileName).to.equal('file2.json')
      expect(response.requestId).to.equal('req-123')
    })

    it('should create response with single presigned URL', () => {
      const presignedUrls = [new PresignedUrl('playbook.json', 'https://storage.googleapis.com/bucket/playbook?sig=xyz')]
      const requestId = 'req-456'

      const response = new PresignedUrlsResponse(presignedUrls, requestId)

      expect(response.presignedUrls).to.have.lengthOf(1)
      expect(response.presignedUrls[0].fileName).to.equal('playbook.json')
      expect(response.requestId).to.equal('req-456')
    })

    it('should make presignedUrls array immutable', () => {
      const presignedUrls = [new PresignedUrl('file.json', 'https://storage.googleapis.com/bucket/file?sig=abc')]
      const response = new PresignedUrlsResponse(presignedUrls, 'req-789')

      expect(Object.isFrozen(response.presignedUrls)).to.be.true
    })

    it('should not share reference with original array', () => {
      const presignedUrls = [new PresignedUrl('file.json', 'https://storage.googleapis.com/bucket/file?sig=abc')]
      const response = new PresignedUrlsResponse(presignedUrls, 'req-789')

      // Modify original array
      presignedUrls.push(new PresignedUrl('file2.json', 'https://storage.googleapis.com/bucket/file2?sig=def'))

      // Response should still have only 1 item
      expect(response.presignedUrls).to.have.lengthOf(1)
    })

    it('should throw error for empty presigned URLs array', () => {
      const presignedUrls: PresignedUrl[] = []
      const requestId = 'req-123'

      expect(() => new PresignedUrlsResponse(presignedUrls, requestId)).to.throw('Presigned URLs array cannot be empty')
    })

    it('should throw error for empty request ID', () => {
      const presignedUrls = [new PresignedUrl('file.json', 'https://storage.googleapis.com/bucket/file?sig=abc')]
      const requestId = ''

      expect(() => new PresignedUrlsResponse(presignedUrls, requestId)).to.throw('Request ID cannot be empty')
    })

    it('should throw error for whitespace-only request ID', () => {
      const presignedUrls = [new PresignedUrl('file.json', 'https://storage.googleapis.com/bucket/file?sig=abc')]
      const requestId = '   '

      expect(() => new PresignedUrlsResponse(presignedUrls, requestId)).to.throw('Request ID cannot be empty')
    })

    it('should allow request ID with spaces if not all whitespace', () => {
      const presignedUrls = [new PresignedUrl('file.json', 'https://storage.googleapis.com/bucket/file?sig=abc')]
      const requestId = 'req 123'

      const response = new PresignedUrlsResponse(presignedUrls, requestId)

      expect(response.requestId).to.equal('req 123')
    })
  })
})
