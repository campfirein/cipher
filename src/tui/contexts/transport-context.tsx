import {type ConnectionState, type ITransportClient} from '@campfirein/brv-transport-client'
import React, {createContext, useContext, useEffect, useState} from 'react'

import {createDaemonAwareConnector} from '../../server/infra/transport/transport-connector.js'

/**
 * Context value for transport client state.
 */
export type TransportContextValue = {
  /** The connected transport client, or null if not connected */
  client: ITransportClient | null
  /** Current connection state */
  connectionState: ConnectionState
  /** Connection error if any */
  error: Error | null
  /** Whether the client is connected */
  isConnected: boolean
  /** Number of reconnection attempts */
  reconnectCount: number
}

const TransportContext = createContext<TransportContextValue | undefined>(undefined)

/**
 * Provider component that manages transport client connection and state.
 * Subscribes to task and LLM events from the transport server.
 */
export function TransportProvider({children}: {children: React.ReactNode}): React.ReactElement {
  const [client, setClient] = useState<ITransportClient | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [error, setError] = useState<Error | null>(null)
  const [reconnectCount, setReconnectCount] = useState(0)

  useEffect(() => {
    let mounted = true
    let transportClient: ITransportClient | null = null
    let stateChangeUnsubscribe: (() => void) | undefined

    async function initializeTransport() {
      try {
        setConnectionState('connecting')

        // Connect to daemon (auto-start if needed)
        const {client: newClient} = await createDaemonAwareConnector()()

        if (!mounted) {
          await newClient.disconnect()
          return
        }

        transportClient = newClient

        // Subscribe to connection state changes
        stateChangeUnsubscribe = newClient.onStateChange((state: ConnectionState) => {
          setConnectionState(state)
          if (state === 'reconnecting') {
            setReconnectCount((prev) => prev + 1)
          }
        })

        // Join broadcast room to receive all events
        await newClient.joinRoom('broadcast-room')

        // Set client in state
        setClient(newClient)
        setConnectionState(newClient.getState())
        setError(null)
      } catch (error_) {
        if (mounted) {
          setError(error_ instanceof Error ? error_ : new Error(String(error_)))
          setConnectionState('disconnected')
        }
      }
    }

    initializeTransport()

    return () => {
      mounted = false
      if (stateChangeUnsubscribe) {
        stateChangeUnsubscribe()
      }

      if (transportClient) {
        transportClient.disconnect().catch(() => {
          // Ignore errors during cleanup
        })
      }
    }
  }, [])

  const value: TransportContextValue = {
    client,
    connectionState,
    error,
    isConnected: connectionState === 'connected',
    reconnectCount,
  }

  return <TransportContext.Provider value={value}>{children}</TransportContext.Provider>
}

/**
 * Hook to access transport client from context.
 * @throws Error if used outside TransportProvider
 */
export function useTransport(): TransportContextValue {
  const context = useContext(TransportContext)
  if (!context) {
    throw new Error('useTransport must be used within a TransportProvider')
  }

  return context
}
