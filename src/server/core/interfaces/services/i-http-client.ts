/**
 * Configuration options for HTTP requests.
 */
export type HttpRequestConfig = {
  headers?: Record<string, string>
  timeout?: number
}

/**
 * Interface for HTTP client operations.
 * Provides abstraction over HTTP libraries (axios, fetch, etc.) following Clean Architecture principles.
 *
 * Implementations should handle:
 * - Request configuration (headers, timeout)
 * - Error handling and transformation
 * - Response parsing
 */
export interface IHttpClient {
  /**
   * Performs an HTTP GET request.
   * @param url The URL to request
   * @param config Optional request configuration (headers, timeout)
   * @returns A promise that resolves to the response data
   */
  get: <T>(url: string, config?: HttpRequestConfig) => Promise<T>

  /**
   * Performs an HTTP POST request.
   * @param url The URL to request
   * @param data The data to send in the request body
   * @param config Optional request configuration (headers, timeout)
   * @returns A promise that resolves to the response data
   */
  post: <TResponse, TData = unknown>(url: string, data?: TData, config?: HttpRequestConfig) => Promise<TResponse>
}
