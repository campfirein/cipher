import type {RetrieveResult} from '../../domain/entities/retrieve-result.js'

export type RetrieveParams = {
  accessToken: string
  nodeKeys?: string[]
  query: string
  sessionKey: string
  spaceId: string
}

/**
 * Interface for memory retrieval operations from ByteRover Memora service.
 * This service is responsible for fetching memories based on search queries.
 */
export interface IMemoryRetrievalService {
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
}
