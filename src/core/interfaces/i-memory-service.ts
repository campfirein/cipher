import type {PresignedUrl} from '../domain/entities/presigned-url.js'

/**
 * Parameters for requesting presigned URLs.
 */
export type GetPresignedUrlsParams = {
  accessToken: string
  branch: string
  fileNames: string[]
  sessionKey: string
  spaceId: string
  teamId: string
}

/**
 * Port for memory service operations.
 * Handles communication with ByteRover's memory storage (cogit) service.
 */
export interface IMemoryService {
  getPresignedUrls: (params: GetPresignedUrlsParams) => Promise<PresignedUrl[]>
}
