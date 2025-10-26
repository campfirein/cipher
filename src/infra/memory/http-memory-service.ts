/* eslint-disable camelcase */
import type {IMemoryService, RetrieveParams} from '../../core/interfaces/i-memory-service.js'

import {Memory} from '../../core/domain/entities/memory.js'
import {RetrieveResult} from '../../core/domain/entities/retrieve-result.js'
import {AuthenticatedHttpClient} from '../http/authenticated-http-client.js'

export type MemoryServiceConfig = {
  apiBaseUrl: string
  timeout?: number
}

type MemoryApiResponse = {
  children_ids: string[]
  content: string
  id: string
  node_keys: string[]
  parent_ids: string[]
  score: number
  title: string
}

type RetrieveApiResponse = {
  memories: MemoryApiResponse[]
  related_memories: MemoryApiResponse[]
}

export class HttpMemoryService implements IMemoryService {
  private readonly config: MemoryServiceConfig

  public constructor(config: MemoryServiceConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? 30_000, // Default 30 seconds timeout (memory retrieval may be slower)
    }
  }

  public async retrieve(params: RetrieveParams): Promise<RetrieveResult> {
    try {
      const httpClient = new AuthenticatedHttpClient(params.accessToken, params.sessionKey)

      // Build query parameters
      const queryParams = this.buildQueryParams(params)

      const response = await httpClient.get<RetrieveApiResponse>(`${this.config.apiBaseUrl}/retrieve?${queryParams}`, {
        timeout: this.config.timeout,
      })

      return this.mapToRetrieveResult(response)
    } catch (error) {
      throw new Error(`Failed to retrieve memories: ${(error as Error).message}`)
    }
  }

  private buildQueryParams(params: RetrieveParams): string {
    const queryParams = new URLSearchParams({
      project_id: params.spaceId,
      query: params.query,
    })

    // Add node_keys only if provided
    if (params.nodeKeys && params.nodeKeys.length > 0) {
      queryParams.set('node_keys', params.nodeKeys.join(','))
    }

    return queryParams.toString()
  }

  private mapToMemory(apiMemory: MemoryApiResponse): Memory {
    return new Memory({
      childrenIds: apiMemory.children_ids,
      content: apiMemory.content,
      id: apiMemory.id,
      nodeKeys: apiMemory.node_keys,
      parentIds: apiMemory.parent_ids,
      score: apiMemory.score,
      title: apiMemory.title,
    })
  }

  private mapToRetrieveResult(response: RetrieveApiResponse): RetrieveResult {
    return new RetrieveResult({
      memories: response.memories.map((m) => this.mapToMemory(m)),
      relatedMemories: response.related_memories.map((m) => this.mapToMemory(m)),
    })
  }
}
