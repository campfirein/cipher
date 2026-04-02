/* eslint-disable camelcase */
import axios from 'axios'

import type {ICogitPushService, PushParams} from '../../core/interfaces/services/i-cogit-push-service.js'

import {CogitPushResponse} from '../../core/domain/entities/cogit-push-response.js'
import {getErrorMessage} from '../../utils/error-helpers.js'
import {ProxyConfig} from '../http/proxy-config.js'

export type HttpCogitPushServiceConfig = {
  apiBaseUrl: string
  timeout?: number
}

type PushRequestBody = {
  branch: string
  current_sha: string
  memories: PushContextBody[]
}

type PushContextBody = {
  content: string
  operation: string
  path: string
  tags: string[]
  title: string
}

type PushApiResponse = {
  commit_sha: string
  message: string
  success: boolean
}

type PushApiErrorResponse = {
  code: string
  error?: string
  success: boolean
}

type MakeRequestParams = {
  accessToken: string
  branch: string
  currentSha: string
  memories: PushContextBody[]
  sessionKey: string
  url: string
}

/**
 * Extracts the current SHA from an error response details field.
 * Error format: "...Expected SHA 'xxx' but current SHA is 'yyy'..."
 * @param details The error details string
 * @returns The extracted SHA or undefined if not found
 */
const extractShaFromErrorDetails = (details: string): string | undefined => {
  const shaMatch = /SHA is '([a-f0-9]+)'/i.exec(details)
  return shaMatch?.[1]
}

/**
 * HTTP implementation of ICogitPushService for ByteRover CoGit service.
 * Implements a two-request SHA flow to handle concurrent updates.
 */
export class HttpCogitPushService implements ICogitPushService {
  private readonly config: HttpCogitPushServiceConfig

  public constructor(config: HttpCogitPushServiceConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? 30_000,
    }
  }

  public async push(params: PushParams): Promise<CogitPushResponse> {
    const url = `${this.config.apiBaseUrl}/organizations/${params.teamId}/projects/${params.spaceId}/commits`

    const memories: PushContextBody[] = params.contexts.map((context) => ({
      content: context.content,
      operation: context.operation,
      path: context.path,
      tags: [...context.tags],
      title: context.title,
    }))

    // First request: Send with empty current_sha
    // This is a temporary workaround to let CoGit determine the current SHA.
    // In the future, we need to generate the SHA from the CLI.
    try {
      const response = await this.makeRequest({
        accessToken: params.accessToken,
        branch: params.branch,
        currentSha: 'sha_placeholder',
        memories,
        sessionKey: params.sessionKey,
        url,
      })
      return response
    } catch (error) {
      // Try to extract SHA from error response
      const sha = this.extractShaFromError(error)
      if (!sha) {
        throw new Error(`Failed to push to CoGit: ${getErrorMessage(error)}`)
      }

      // Second request: Retry with extracted SHA
      try {
        const response = await this.makeRequest({
          accessToken: params.accessToken,
          branch: params.branch,
          currentSha: sha,
          memories,
          sessionKey: params.sessionKey,
          url,
        })
        return response
      } catch (retryError) {
        throw new Error(`Failed to push to CoGit: ${getErrorMessage(retryError)}`)
      }
    }
  }

  private extractShaFromError(error: unknown): string | undefined {
    // Check if error has response data with details
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      typeof error.response === 'object' &&
      'data' in error.response
    ) {
      const errorResponse = error.response.data as PushApiErrorResponse
      if (errorResponse.error) {
        return extractShaFromErrorDetails(errorResponse.error)
      }
    }

    return undefined
  }

  private async makeRequest(params: MakeRequestParams): Promise<CogitPushResponse> {
    const requestBody: PushRequestBody = {
      branch: params.branch,
      current_sha: params.currentSha,
      memories: params.memories,
    }

    // Directly use axios here because of the work around to get current SHA from CoGit's error response
    const response = await axios.post<PushApiResponse>(params.url, requestBody, {
      headers: {
        'x-byterover-session-id': params.sessionKey,
      },
      httpAgent: ProxyConfig.getProxyAgent(),
      httpsAgent: ProxyConfig.getProxyAgent(),
      proxy: false,
      timeout: this.config.timeout,
    })

    return CogitPushResponse.fromJson(response.data)
  }
}
