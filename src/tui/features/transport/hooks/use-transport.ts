/**
 * Transport Hook
 *
 * Provides transport client state with the same interface as the old context.
 */

import type {TransportState} from '../../../stores/transport-store.js'

import {useTransportStore} from '../../../stores/transport-store.js'

export interface UseTransportReturn {
  /** The connected transport client, or null if not connected */
  client: TransportState['client']
  /** Current connection state */
  connectionState: TransportState['connectionState']
  /** Connection error if any */
  error: TransportState['error']
  /** Whether the client is connected */
  isConnected: boolean
  /** Number of reconnection attempts */
  reconnectCount: number
}

export function useTransport(): UseTransportReturn {
  const store = useTransportStore()

  return {
    client: store.client,
    connectionState: store.connectionState,
    error: store.error,
    isConnected: store.isConnected,
    reconnectCount: store.reconnectCount,
  }
}
