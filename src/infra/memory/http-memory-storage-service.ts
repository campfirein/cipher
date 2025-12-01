/* eslint-disable camelcase */
import axios from 'axios'

import type {
  ConfirmUploadParams,
  GetPresignedUrlsParams,
  IMemoryStorageService,
} from '../../core/interfaces/i-memory-storage-service.js'

import {PresignedUrl} from '../../core/domain/entities/presigned-url.js'
import {PresignedUrlsResponse} from '../../core/domain/entities/presigned-urls-response.js'
import {getErrorMessage} from '../../utils/error-helpers.js'
import {AuthenticatedHttpClient} from '../http/authenticated-http-client.js'

export type MemoryStorageServiceConfig = {
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

/**
 * HTTP implementation of IMemoryStorageService for ByteRover CoGit service.
 * Handles uploading playbooks to blob storage.
 */
export class HttpMemoryStorageService implements IMemoryStorageService {
  private readonly config: MemoryStorageServiceConfig

  public constructor(config: MemoryStorageServiceConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? 30_000, // Default 30 seconds timeout
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
      throw new Error(`Failed to confirm upload: ${getErrorMessage(error)}`)
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
      throw new Error(`Failed to get presigned URLs: ${getErrorMessage(error)}`)
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
      throw new Error(`Failed to upload file: ${getErrorMessage(error)}`)
    }
  }

  private mapToPresignedUrls(presignedUrlData: PresignedUrlsApiResponse): PresignedUrl {
    return new PresignedUrl(presignedUrlData.file_name, presignedUrlData.presigned_url)
  }
}
