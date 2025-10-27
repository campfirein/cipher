/* eslint-disable camelcase */
import axios from 'axios'

import type {
  ConfirmUploadParams,
  GetPresignedUrlsParams,
  IMemoryService,
  RetrieveParams,
} from '../../core/interfaces/i-memory-service.js'

import {Memory} from '../../core/domain/entities/memory.js'
import {PresignedUrl} from '../../core/domain/entities/presigned-url.js'
import {PresignedUrlsResponse} from '../../core/domain/entities/presigned-urls-response.js'
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

type GetPresignedUrlsRequestBody = {
  branch: string
  file_names: string[]
}

type GetPresignedUrlsApiResponse = {
  data: GetPresignedUrlsApiData
  message: string
  success: boolean
}

type GetPresignedUrlsApiData = {
  presigned_urls: PresignedUrlsApiResponse[]
  request_id: string
}

type PresignedUrlsApiResponse = {
  file_name: string
  presigned_url: string
}

type ConfirmUploadRequestBody = {
  request_id: string
}

type ConfirmUploadApiResponse = {
  data: {
    message: string
    request_id: string
    status: string
  }
  message: string
  success: boolean
}

export class HttpMemoryService implements IMemoryService {
  private readonly config: MemoryServiceConfig

  public constructor(config: MemoryServiceConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? 30_000, // Default 30 seconds timeout (memory retrieval may be slower)
    }
  }

  public async confirmUpload(params: ConfirmUploadParams): Promise<void> {
    try {
      const httpClient = new AuthenticatedHttpClient(params.accessToken, params.sessionKey)
      const url = `${this.config.apiBaseUrl}/organizations/${params.teamId}/projects/${params.spaceId}/memory-processing/confirm-upload`

      const requestBody: ConfirmUploadRequestBody = {
        request_id: params.requestId,
      }

      await httpClient.post<ConfirmUploadApiResponse>(url, requestBody, {
        timeout: this.config.timeout,
      })
    } catch (error) {
      throw new Error(`Failed to confirm upload: ${(error as Error).message}`)
    }
  }

  public async getPresignedUrls(params: GetPresignedUrlsParams): Promise<PresignedUrlsResponse> {
    try {
      const httpClient = new AuthenticatedHttpClient(params.accessToken, params.sessionKey)
      const url = `${this.config.apiBaseUrl}/organizations/${params.teamId}/projects/${params.spaceId}/memory-processing/presigned-urls`

      const requestBody: GetPresignedUrlsRequestBody = {
        branch: params.branch,
        file_names: params.fileNames,
      }

      const response = await httpClient.post<GetPresignedUrlsApiResponse>(url, requestBody, {
        timeout: this.config.timeout,
      })

      const presignedUrls = response.data.presigned_urls.map((presignedUrlData) =>
        this.mapToPresignedUrls(presignedUrlData),
      )
      return new PresignedUrlsResponse(presignedUrls, response.data.request_id)
    } catch (error) {
      throw new Error(`Failed to get presigned URLs: ${(error as Error).message}`)
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

  public async uploadFile(uploadUrl: string, content: string): Promise<void> {
    try {
      await axios.put(uploadUrl, content, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.config.timeout,
      })
    } catch (error) {
      throw new Error(`Failed to upload file: ${(error as Error).message}`)
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

  private mapToPresignedUrls(presignedUrlData: PresignedUrlsApiResponse): PresignedUrl {
    return new PresignedUrl(presignedUrlData.file_name, presignedUrlData.presigned_url)
  }

  private mapToRetrieveResult(response: RetrieveApiResponse): RetrieveResult {
    return new RetrieveResult({
      memories: response.memories.map((m) => this.mapToMemory(m)),
      relatedMemories: response.related_memories.map((m) => this.mapToMemory(m)),
    })
  }
}
