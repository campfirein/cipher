import axios, {type AxiosRequestConfig, isAxiosError} from 'axios'

import type {
  IResolveByUrlService,
  ResolveByUrlInput,
  ResolveByUrlResult,
} from '../../core/interfaces/services/i-resolve-by-url-service.js'

import {ResolveByUrlError} from '../../core/domain/errors/resolve-by-url-error.js'
import {ProxyConfig} from '../http/proxy-config.js'

export type ResolveByUrlServiceConfig = {
  apiBaseUrl: string
  timeout?: number
}

type ResolveByUrlApiResponse = {
  code: number
  data: {
    space: {id: string; name: string; slug: string}
    team: {id: string; name: string; slug: string}
    url: string
  }
  message: string
}

const SESSION_HEADER = 'x-byterover-session-id'

export class HttpResolveByUrlService implements IResolveByUrlService {
  private readonly config: ResolveByUrlServiceConfig

  public constructor(config: ResolveByUrlServiceConfig) {
    this.config = {
      ...config,
      timeout: config.timeout ?? 10_000,
    }
  }

  public async resolveByUrl(input: ResolveByUrlInput, sessionKey?: string): Promise<ResolveByUrlResult> {
    const url = `${this.config.apiBaseUrl}/git/resolve`
    const headers: Record<string, string> = {}
    if (sessionKey !== undefined && sessionKey !== '') {
      headers[SESSION_HEADER] = sessionKey
    }

    const axiosConfig: AxiosRequestConfig = {
      headers,
      httpAgent: ProxyConfig.getProxyAgent(),
      httpsAgent: ProxyConfig.getProxyAgent(),
      params: {space: input.spaceSlug, team: input.teamSlug},
      proxy: false,
      timeout: this.config.timeout,
    }

    try {
      const response = await axios.get<ResolveByUrlApiResponse>(url, axiosConfig)
      return response.data.data
    } catch (error) {
      if (isAxiosError(error) && error.response) {
        const {status} = error.response
        if (status === 403 || status === 404) {
          const message = extractMessage(error.response.data) ?? `HTTP ${status}`
          throw new ResolveByUrlError(status, message)
        }
      }

      throw error
    }
  }
}

function extractMessage(data: unknown): string | undefined {
  if (typeof data === 'object' && data !== null && 'message' in data) {
    const {message} = data as {message: unknown}
    if (typeof message === 'string') return message
  }

  return undefined
}
