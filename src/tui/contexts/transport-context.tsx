import {type ConnectionState, connectToDaemon, type ITransportClient} from '@campfirein/brv-transport-client'
import React, {createContext, useContext, useEffect, useState} from 'react'

import {detectMcpMode} from '../../server/infra/mcp/mcp-mode-detector.js'
import {resolveLocalServerMainPath} from '../../server/utils/server-main-resolver.js'

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
 *
 * Creates a single Socket.IO connection registered as 'tui' with:
 * - projectPath for server-side project tracking
 * - broadcast-room for global events (auth:updated, agent connect/disconnect)
 * - Task/LLM events arrive via the project-scoped room (server adds TUI on registration)
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

        const {projectRoot} = detectMcpMode(process.cwd())

        // Single connection: register as TUI, join broadcast-room, provide projectPath
        const {client: newClient} = await connectToDaemon({
          clientType: 'tui',
          joinRooms: ['broadcast-room'],
          serverPath: resolveLocalServerMainPath(),
          ...(projectRoot ? {projectPath: projectRoot} : {}),
        })

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
