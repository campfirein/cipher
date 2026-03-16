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
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      this.socket.emit(event, data, (response: AckResponse<TResponse>) => {
        if (response.success) {
          resolve(response.data)
        } else {
          reject(new Error(response.error ?? 'Request failed'))
        }
      })
    })
  }
}
