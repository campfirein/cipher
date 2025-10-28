import type {PresignedUrl} from './presigned-url.js'

/**
 * Represents the response from requesting presigned URLs.
 * Contains both the presigned URLs for file upload and the request ID for confirmation.
 */
export class PresignedUrlsResponse {
  public readonly presignedUrls: ReadonlyArray<PresignedUrl>
  public readonly requestId: string

  public constructor(presignedUrls: PresignedUrl[], requestId: string) {
    if (presignedUrls.length === 0) {
      throw new Error('Presigned URLs array cannot be empty')
    }

    if (requestId.trim().length === 0) {
      throw new Error('Request ID cannot be empty')
    }

    this.presignedUrls = Object.freeze([...presignedUrls])
    this.requestId = requestId
  }
}
