import type {TransportState} from '../../../stores/transport-store'

import {useTransportStore} from '../../../stores/transport-store'

export interface UseTransportReturn {
  connectionState: TransportState['connectionState']
  error: TransportState['error']
  isConnected: boolean
  reconnectCount: number
  version: string
}

export function useTransport(): UseTransportReturn {
  const store = useTransportStore()

  return {
    connectionState: store.connectionState,
    error: store.error,
    isConnected: store.isConnected,
    reconnectCount: store.reconnectCount,
    version: store.version,
  }
}
