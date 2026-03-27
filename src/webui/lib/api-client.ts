/**
 * BrvApiClient (browser version)
 *
 * Typed wrapper around socket.io-client Socket.
 * Provides request/response and event subscription primitives.
 * Mirror of src/tui/lib/api-client.ts without Node.js transport logger.
 */

import type {Socket} from 'socket.io-client'

interface AckResponse<T> {
  data: T
  error?: string
  success: boolean
}

export interface RequestOptions {
  timeout?: number
}

export class BrvApiClient {
  constructor(private readonly socket: Socket) {}

  on<T>(event: string, handler: (data: T) => void): () => void {
    this.socket.on(event, handler as (...args: unknown[]) => void)
    return () => {
      this.socket.off(event, handler as (...args: unknown[]) => void)
    }
  }

  async request<TResponse, TRequest = unknown>(
    event: string,
    data?: TRequest,
    options?: RequestOptions,
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      let didFinish = false
      const timeoutId = options?.timeout
        ? globalThis.setTimeout(() => {
            didFinish = true
            reject(new Error(`Request timed out after ${options.timeout}ms`))
          }, options.timeout)
        : undefined

      this.socket.emit(event, data, (response: AckResponse<TResponse>) => {
        if (didFinish) return

        didFinish = true
        if (timeoutId !== undefined) {
          globalThis.clearTimeout(timeoutId)
        }

        if (response.success) {
          resolve(response.data)
        } else {
          reject(new Error(response.error ?? 'Request failed'))
        }
      })
    })
  }
}
