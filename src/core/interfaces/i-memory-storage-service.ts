import type {PresignedUrlsResponse} from '../domain/entities/presigned-urls-response.js'

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
 * Parameters for confirming upload completion.
 */
export type ConfirmUploadParams = {
  accessToken: string
  requestId: string
  sessionKey: string
  spaceId: string
  teamId: string
}

/**
 * Interface for memory storage operations to ByteRover CoGit service.
 * This service is responsible for uploading playbooks to blob storage.
 */
export interface IMemoryStorageService {
  /**
   * Confirms that file upload is complete.
   * Notifies the server that all files have been successfully uploaded to blob storage.
   *
   * @param params Confirmation parameters including request ID from presigned URLs response
   * @returns Promise that resolves when confirmation succeeds
   * @throws Error if confirmation fails
   */
  confirmUpload: (params: ConfirmUploadParams) => Promise<void>

  /**
   * Generates presigned URLs for uploading files to memory storage.
   *
   * @param params Request parameters including authentication, identifiers, and file list
   * @returns Response object containing presigned URLs and request ID for confirmation
   * @throws Error if the request fails
   */
  getPresignedUrls: (params: GetPresignedUrlsParams) => Promise<PresignedUrlsResponse>

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
