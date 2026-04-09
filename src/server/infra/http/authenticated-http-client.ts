import axios, {type AxiosRequestConfig, isAxiosError} from 'axios'

import type {HttpRequestConfig, IHttpClient} from '../../core/interfaces/services/i-http-client.js'

import {ProxyConfig} from './proxy-config.js'

/**
 * Standardized API error response from server.
 *
 * Matches the server-side ApiErrorResponse format for consistent error handling.
 */
type ApiErrorResponse = {
  /** Error code for programmatic handling (e.g., AUTH_INVALID_TOKEN, LLM_GENERATION_FAILED) */
  code: string
  /** Optional additional error details */
  details?: Record<string, unknown>
  /** Human-readable error message */
  message: string
  /** HTTP status code */
  statusCode: number
  /** ISO timestamp when error occurred */
  timestamp: string
}

type LLMServerError = {
  response: {
    data: ApiErrorResponse | Record<string, unknown>
    status: number
    statusText: string
  }
}

/**
 * HTTP client implementation that automatically adds authentication headers to all requests.
 *
 * This client wraps axios and automatically includes:
 * - x-byterover-session-id: {sessionKey}
 *
 * Usage:
 * ```typescript
 * const client = new AuthenticatedHttpClient(accessToken, sessionKey)
 * const data = await client.get<ResponseType>('https://api.example.com/endpoint')
 * ```
 */
export class AuthenticatedHttpClient implements IHttpClient {
  private readonly sessionKey: string

  public constructor(sessionKey: string) {
    this.sessionKey = sessionKey
  }

  /**
   * Performs an HTTP DELETE request with authentication headers.
   * @param url The URL to request
   * @param config Optional request configuration (headers, timeout)
   * @returns A promise that resolves to the response data
   * @throws Error if the request fails
   */
  public async delete<T = void>(url: string, config?: HttpRequestConfig): Promise<T> {
    try {
      const axiosConfig: AxiosRequestConfig = {
        headers: this.buildHeaders(config?.headers),
        httpAgent: ProxyConfig.getProxyAgent(),
        httpsAgent: ProxyConfig.getProxyAgent(),
        proxy: false,
        timeout: config?.timeout,
      }

      const response = await axios.delete<T>(url, axiosConfig)
      return response.data
    } catch (error) {
      throw this.handleError(error)
    }
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
        httpAgent: ProxyConfig.getProxyAgent(),
        httpsAgent: ProxyConfig.getProxyAgent(),
        proxy: false,
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
        httpAgent: ProxyConfig.getProxyAgent(),
        httpsAgent: ProxyConfig.getProxyAgent(),
        proxy: false,
        timeout: config?.timeout,
      }

      const response = await axios.post<TResponse>(url, data, axiosConfig)
      return response.data
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * Performs an HTTP PUT request with authentication headers.
   * @param url The URL to request
   * @param data The data to send in the request body
   * @param config Optional request configuration (headers, timeout)
   * @returns A promise that resolves to the response data
   * @throws Error if the request fails
   */
  public async put<TResponse, TData = unknown>(
    url: string,
    data?: TData,
    config?: HttpRequestConfig,
  ): Promise<TResponse> {
    try {
      const axiosConfig: AxiosRequestConfig = {
        headers: this.buildHeaders(config?.headers),
        httpAgent: ProxyConfig.getProxyAgent(),
        httpsAgent: ProxyConfig.getProxyAgent(),
        proxy: false,
        timeout: config?.timeout,
      }

      const response = await axios.put<TResponse>(url, data, axiosConfig)
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
      'x-byterover-session-id': this.sessionKey,
      ...customHeaders,
    }
  }

  /**
   * Transforms axios errors into generic Error instances.
   * Preserves error information while abstracting axios-specific details.
   */
  private handleError(error: unknown): Error {
    if (isAxiosError(error) && error.response?.status === 401) {
      // IMPORTANT: Do not handle 401 errors here - let callers handle errors (e.g., distinguish 401 from network errors)
      return error
    }

    // WARNING: isLLMServerError() matches any response with the standard ApiErrorResponse structure (IAM, Cogit, LLM services all use it)
    if (this.isLLMServerError(error)) {
      // Extract standardized API error message
      return new Error(this.parseHttpError(error))
    }

    if (isAxiosError(error)) {
      if (error.response) {
        // Server responded with error status
        return new Error(`HTTP ${error.response.status}: ${error.response.statusText}`)
      }

      // Enterprise Proxy / SSL Checks
      if (error.code === 'SELF_SIGNED_CERT_IN_CHAIN' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || error.code === 'CERT_HAS_EXPIRED') {
        return new Error(
          `SSL Certificate Validation Failed (${error.code}). Your company may be using SSL Inspection.\n` +
          `Solution: Set the NODE_EXTRA_CA_CERTS environment variable to your corporate CA certificate path.\n` +
          `Example: export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem`
        )
      }

      const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.message.includes('timeout')
      const isRefused = error.code === 'ECONNREFUSED'
      if (isTimeout || isRefused) {
        return new Error(
          `Connection Failed (${error.code || 'TIMEOUT'}). If you are behind a corporate firewall, configure your proxy:\n` +
          `  export HTTPS_PROXY=http://proxy-host:port`
        )
      }

      if (error.request) {
        // Request was made but no response received
        return new Error('Network error: No response received from server. Check your proxy or internet connection.')
      }
    }

    // Generic error
    if (error instanceof Error) {
      return error
    }

    return new Error('Unknown error occurred')
  }

  /**
   * Type guard to check if error is an axios error with response.
   */
  private isLLMServerError(error: unknown): error is LLMServerError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'response' in error &&
      typeof (error as LLMServerError).response === 'object'
    )
  }

  /**
   * Parse HTTP error to extract user-friendly error message.
   *
   * Handles standardized API error responses from the server:
   * ```json
   * {
   *   "statusCode": 401,
   *   "code": "AUTH_INVALID_TOKEN",
   *   "message": "Your authentication token is invalid. Please login again.",
   *   "timestamp": "2024-01-01T00:00:00.000Z"
   * }
   * ```
   *
   * @param error - HTTP error object (may contain response data)
   * @returns User-friendly error message
   */
  private parseHttpError(error: LLMServerError): string {
    const responseData = error.response.data

    // If server returned standardized API error format, use the message
    if ('message' in responseData && typeof responseData.message === 'string') {
      return responseData.message
    }

    // Some endpoints return 'error' instead of 'message'
    if ('error' in responseData && typeof responseData.error === 'string') {
      return responseData.error
    }

    // Fallback to HTTP status error
    return `HTTP ${error.response.status}: ${error.response.statusText}`
  }
}
