/**
 * Transport Provider
 *
 * Connects to the daemon via Socket.IO on mount and manages
 * the transport lifecycle. Sets socket + apiClient in the
 * transport store for all components to use.
 *
 * When the daemon is not running, shows an offline screen
 * prompting the user to run `brv webui`. Socket.IO
 * auto-reconnects when the daemon appears.
 */

import type {ReactNode} from 'react'

import {Badge} from '@campfirein/byterover-packages/components/badge'
import {CardDescription, CardTitle} from '@campfirein/byterover-packages/components/card'
import {useEffect} from 'react'

import {connectToTransport} from '../lib/transport'
import {useTransportStore} from '../stores/transport-store'

function OfflineScreen({error}: {error?: Error | null}) {
  const isConfigError = error?.message.includes('Failed to fetch UI config')

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
        <Badge className="rounded-sm border-orange-500/20 bg-orange-500/10 text-orange-600" variant="outline">
          Offline
        </Badge>
        <CardTitle>ByteRover is not running</CardTitle>
        <CardDescription>
          {isConfigError
            ? 'The web UI server is not available.'
            : 'Could not connect to the ByteRover daemon.'}
        </CardDescription>
        <div className="mt-2 rounded-md bg-muted px-4 py-3 font-mono text-sm">
          brv webui
        </div>
        <CardDescription>
          Run this command in your terminal to start.
        </CardDescription>
      </div>
    </div>
  )
}

export function TransportProvider({children}: {children: ReactNode}) {
  const {incrementReconnectCount, setConnectionState, setError, setSocket} = useTransportStore()

  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        setConnectionState('connecting')
        const {config, socket} = await connectToTransport()

        if (!mounted) {
          socket.disconnect()
          return
        }

        setSocket(socket, config)

        socket.on('disconnect', () => {
          if (mounted) setConnectionState('disconnected')
        })

        socket.io.on('reconnect_attempt', () => {
          if (mounted) {
            incrementReconnectCount()
            setConnectionState('reconnecting')
          }
        })

        socket.io.on('reconnect', () => {
          if (mounted) setConnectionState('connected')
        })
      } catch (error) {
        if (mounted) {
          setError(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    init()

    return () => {
      mounted = false
      const {socket} = useTransportStore.getState()
      socket?.disconnect()
    }
  }, [incrementReconnectCount, setConnectionState, setError, setSocket])

  const connectionState = useTransportStore((s) => s.connectionState)
  const error = useTransportStore((s) => s.error)
  const apiClient = useTransportStore((s) => s.apiClient)

  if (error) {
    return <OfflineScreen error={error} />
  }

  if (connectionState === 'connecting') {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center">
          <Badge className="rounded-sm border-blue-500/20 bg-blue-500/10 text-blue-600" variant="outline">
            Connecting
          </Badge>
          <CardTitle>Connecting to ByteRover</CardTitle>
          <CardDescription>Waiting for the daemon...</CardDescription>
        </div>
      </div>
    )
  }

  if (!apiClient) {
    return <OfflineScreen />
  }

  return <>{children}</>
}
