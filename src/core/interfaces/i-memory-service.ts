import type {PresignedUrl} from '../domain/entities/presigned-url.js'
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
 * Interface for memory operations.
 * Implementations can be HTTP-based (for production) or mock (for testing/development).
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
