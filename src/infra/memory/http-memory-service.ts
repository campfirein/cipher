/* eslint-disable camelcase */
import axios from 'axios'

import type {ConfirmUploadParams, GetPresignedUrlsParams, IMemoryService} from '../../core/interfaces/i-memory-service.js'

import {PresignedUrl} from '../../core/domain/entities/presigned-url.js'
import {PresignedUrlsResponse} from '../../core/domain/entities/presigned-urls-response.js'
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
      timeout: config.timeout ?? 30_000, // Default 30 seconds for upload operations
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

      const presignedUrls = response.data.presigned_urls.map((presignedUrlData) => this.mapToPresignedUrls(presignedUrlData))
      return new PresignedUrlsResponse(presignedUrls, response.data.request_id)
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
