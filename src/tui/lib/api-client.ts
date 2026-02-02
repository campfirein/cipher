/**
 * BrvApiClient
 *
 * Generic typed wrapper around ITransportClient.
 * Provides request/response and event subscription primitives.
 * Domain-specific methods live in each feature's api/ files.
 */

import type {ITransportClient} from '@campfirein/brv-transport-client'

import {logTransportEvent} from './transport-logger.js'

export class BrvApiClient {
  constructor(private readonly client: ITransportClient) {}

  /**
   * Subscribe to a transport event. Returns an unsubscribe function.
   */
  on<T>(event: string, handler: (data: T) => void): () => void {
    return this.client.on<T>(event, handler)
  }

  /**
   * Send a request and wait for an acknowledged response.
   */
  async request<TResponse, TRequest = unknown>(event: string, data?: TRequest): Promise<TResponse> {
    logTransportEvent(event, data)
    const response = await this.client.requestWithAck<TResponse, TRequest>(event, data)
    logTransportEvent(event, response)
    return response
  }
}
