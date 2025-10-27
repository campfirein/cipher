/* eslint-disable camelcase */
import axios from 'axios'

import type {GetPresignedUrlsParams, IMemoryService} from '../../core/interfaces/i-memory-service.js'

import {PresignedUrl} from '../../core/domain/entities/presigned-url.js'
import {AuthenticatedHttpClient} from '../http/authenticated-http-client.js'

export type MemoryServiceConfig = {
  apiBaseUrl: string
  timeout?: number
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

export class HttpMemoryService implements IMemoryService {
  private readonly config: MemoryServiceConfig

  public constructor(config: MemoryServiceConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? 30_000, // Default 30 seconds for upload operations
    }
  }

  public async getPresignedUrls(params: GetPresignedUrlsParams): Promise<PresignedUrl[]> {
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
      return response.data.presigned_urls.map((presignedUrlData) => this.mapToPresignedUrls(presignedUrlData))
    } catch (error) {
      throw new Error(`Failed to get presigned URLs: ${(error as Error).message}`)
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

  private mapToPresignedUrls(presignedUrlData: PresignedUrlsApiResponse): PresignedUrl {
    return new PresignedUrl(presignedUrlData.file_name, presignedUrlData.presigned_url)
  }
}
