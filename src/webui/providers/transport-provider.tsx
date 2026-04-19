/**
 * Transport Provider
 *
 * Connects to the daemon via Socket.IO and manages the transport lifecycle.
 * The socket carries the currently selected project in its `client:register`
 * payload, so when the user picks a different project we disconnect and
 * reconnect — giving each project a fresh socket with clean per-client state
 * on the daemon (rooms, agent affinity, association).
 *
 * When the daemon is not running, shows an offline screen prompting the user
 * to run `brv webui`. Socket.IO auto-reconnects when the daemon appears.
 */

import type {ReactNode} from 'react'
import type {Socket} from 'socket.io-client'

import {useEffect} from 'react'

import {ConnectingScreen} from '../features/transport/components/connecting-screen'
import {OfflineScreen} from '../features/transport/components/offline-screen'
import {connectToTransport} from '../lib/transport'
import {useTransportStore} from '../stores/transport-store'

export function TransportProvider({children}: {children: ReactNode}) {
  const incrementReconnectCount = useTransportStore((s) => s.incrementReconnectCount)
  const setConnectionState = useTransportStore((s) => s.setConnectionState)
  const setError = useTransportStore((s) => s.setError)
  const setSocket = useTransportStore((s) => s.setSocket)
  const selectedProject = useTransportStore((s) => s.selectedProject)

  useEffect(() => {
    let mounted = true
    let activeSocket: null | Socket = null
    let retryTimer: null | ReturnType<typeof setTimeout> = null

    async function init() {
      try {
        setConnectionState('connecting')
        const {config, socket} = await connectToTransport(selectedProject)

        if (!mounted) {
          socket.disconnect()
          return
        }

        activeSocket = socket
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
        if (!mounted) return
        // socket.io's built-in reconnect can't help on initial-connect failure
        // because no socket exists yet — poll connectToTransport ourselves so
        // the daemon / dev server is auto-detected once it comes up.
        setError(error instanceof Error ? error : new Error(String(error)))
        incrementReconnectCount()
        retryTimer = setTimeout(init, 3000)
      }
    }

    init()

    return () => {
      mounted = false
      activeSocket?.disconnect()
      if (retryTimer !== null) clearTimeout(retryTimer)
    }
  }, [selectedProject, incrementReconnectCount, setConnectionState, setError, setSocket])

  const connectionState = useTransportStore((s) => s.connectionState)
  const error = useTransportStore((s) => s.error)
  const apiClient = useTransportStore((s) => s.apiClient)

  if (error) {
    return <OfflineScreen error={error} />
  }

  if (connectionState === 'connecting') {
    return <ConnectingScreen />
  }

  if (!apiClient) {
    return <OfflineScreen />
  }

  return <>{children}</>
}
