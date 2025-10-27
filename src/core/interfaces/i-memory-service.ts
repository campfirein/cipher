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
  /**
   * Generates presigned URLs for uploading files to memory storage.
   *
   * @param params Request parameters including authentication, identifiers, and file list
   * @returns Array of presigned URL objects containing file names and upload URLs
   * @throws Error if the request fails
   */
  getPresignedUrls: (params: GetPresignedUrlsParams) => Promise<PresignedUrl[]>

  /**
   * Uploads file content to a presigned URL.
   * Uses HTTP PUT with the file content in the request body.
   *
   * @param uploadUrl The presigned URL from Google Cloud Storage
   * @param content File content as string (typically JSON)
   * @returns Promise that resolves when upload completes
   * @throws Error if upload fails (network error, expired URL, etc.)
   */
  uploadFile: (uploadUrl: string, content: string) => Promise<void>
}
