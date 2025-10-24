import axios, {type AxiosRequestConfig, isAxiosError} from 'axios'

import type {HttpRequestConfig, IHttpClient} from '../../core/interfaces/i-http-client.js'

/**
 * HTTP client implementation that automatically adds authentication headers to all requests.
 *
 * This client wraps axios and automatically includes:
 * - Authorization: Bearer {accessToken}
 * - x-byterover-session-id: {sessionKey}
 *
 * Usage:
 * ```typescript
 * const client = new AuthenticatedHttpClient(accessToken, sessionKey)
 * const data = await client.get<ResponseType>('https://api.example.com/endpoint')
 * ```
 */
export class AuthenticatedHttpClient implements IHttpClient {
  private readonly accessToken: string
  private readonly sessionKey: string

  public constructor(accessToken: string, sessionKey: string) {
    this.accessToken = accessToken
    this.sessionKey = sessionKey
  }

  /**
   * Performs an HTTP GET request with authentication headers.
   * @param url The URL to request
   * @param config Optional request configuration (headers, timeout)
   * @returns A promise that resolves to the response data
   * @throws Error if the request fails
   */
  public async get<T>(url: string, config?: HttpRequestConfig): Promise<T> {
    try {
      const axiosConfig: AxiosRequestConfig = {
        headers: this.buildHeaders(config?.headers),
        timeout: config?.timeout,
      }

      const response = await axios.get<T>(url, axiosConfig)
      return response.data
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * Performs an HTTP POST request with authentication headers.
   * @param url The URL to request
   * @param data The data to send in the request body
   * @param config Optional request configuration (headers, timeout)
   * @returns A promise that resolves to the response data
   * @throws Error if the request fails
   */
  public async post<TResponse, TData = unknown>(
    url: string,
    data?: TData,
    config?: HttpRequestConfig,
  ): Promise<TResponse> {
    try {
      const axiosConfig: AxiosRequestConfig = {
        headers: this.buildHeaders(config?.headers),
        timeout: config?.timeout,
      }

      const response = await axios.post<TResponse>(url, data, axiosConfig)
      return response.data
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * Builds request headers by merging authentication headers with custom headers.
   * Custom headers take precedence over default headers.
   */
  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      'x-byterover-session-id': this.sessionKey,
      ...customHeaders,
    }
  }

  /**
   * Transforms axios errors into generic Error instances.
   * Preserves error information while abstracting axios-specific details.
   */
  private handleError(error: unknown): Error {
    if (isAxiosError(error)) {
      if (error.response) {
        // Server responded with error status
        return new Error(`HTTP ${error.response.status}: ${error.response.statusText}`)
      }

      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        // Request timeout
        return new Error(`Request timeout: ${error.message}`)
      }

      if (error.request) {
        // Request was made but no response received
        return new Error('Network error: No response received from server')
      }
    }

    // Generic error
    if (error instanceof Error) {
      return error
    }

    return new Error('Unknown error occurred')
  }
}
