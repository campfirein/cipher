/**
 * Transport Provider
 *
 * Connects to the daemon via Socket.IO on mount and manages
 * the transport lifecycle. Sets socket + apiClient in the
 * transport store for all components to use.
 */

import type {ReactNode} from 'react'

import {useEffect} from 'react'

import {connectToTransport} from '../lib/transport'
import {useTransportStore} from '../stores/transport-store'

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

  return <>{children}</>
}
