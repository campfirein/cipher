import type {PresignedUrlsResponse} from '../domain/entities/presigned-urls-response.js'
import type {RetrieveResult} from '../domain/entities/retrieve-result.js'

export type RetrieveParams = {
  accessToken: string
  nodeKeys?: string[]
  query: string
  sessionKey: string
  spaceId: string
}

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
 * Interface for memory operations.
 */
export interface IMemoryService {
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
   * Retrieves memories from the ByteRover Memora service based on a search query.
   *
   * @param params The retrieve operation parameters
   * @returns A promise that resolves to the RetrieveResult containing memories and related memories
   *
   * @example
   * // Broad search across entire space
   * const result = await memoryService.retrieve({
   *   query: "authentication best practices",
   *   spaceId: "a0000000-b001-0000-0000-000000000000",
   *   accessToken: token.accessToken,
   *   sessionKey: token.sessionKey,
   * });
   *
   * @example
   * // Scoped search to specific files
   * const result = await memoryService.retrieve({
   *   query: "error handling",
   *   spaceId: "a0000000-b001-0000-0000-000000000000",
   *   accessToken: token.accessToken,
   *   sessionKey: token.sessionKey,
   *   nodeKeys: ["src/auth/login.ts", "src/auth/oauth.ts"],
   * });
   */
  retrieve: (params: RetrieveParams) => Promise<RetrieveResult>

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
