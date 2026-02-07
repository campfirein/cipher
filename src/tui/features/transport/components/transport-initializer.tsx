/**
 * Transport Initializer
 *
 * Connects to the daemon via connectToDaemon() and manages the transport lifecycle.
 * The daemon is already running (ensureDaemonRunning() in main.ts).
 * connectToDaemon() handles: ensure daemon + connect + register + join rooms.
 */

import {type ConnectionState, connectToDaemon, type ITransportClient} from '@campfirein/brv-transport-client'
import React, {useEffect} from 'react'

import {getAllEventValues} from '../../../../shared/transport/events/index.js'
import {initTransportLog, logTransportEvent} from '../../../lib/transport-logger.js'
import {useTransportStore} from '../../../stores/transport-store.js'

interface TransportInitializerProps {
  children: React.ReactNode
}

export function TransportInitializer({children}: TransportInitializerProps): React.ReactNode {
  const {incrementReconnectCount, setClient, setConnectionState, setError} = useTransportStore()

  useEffect(() => {
    let mounted = true
    let stateChangeUnsubscribe: (() => void) | undefined
    const eventUnsubscribes: Array<() => void> = []

    function registerEventHandlers(client: ITransportClient): void {
      // Clear old handlers first
      for (const unsub of eventUnsubscribes) {
        unsub()
      }

      eventUnsubscribes.length = 0

      // Register new handlers
      const eventValues = getAllEventValues()
      logTransportEvent('_handlers', {count: eventValues.length, events: eventValues})

      for (const event of eventValues) {
        const unsub = client.on(event, (data: unknown) => logTransportEvent(event, data))
        eventUnsubscribes.push(unsub)
      }

      logTransportEvent('_handlers', {registered: eventUnsubscribes.length})
    }

    async function initializeTransport() {
      try {
        initTransportLog()
        setConnectionState('connecting')

        // connectToDaemon = ensureDaemonRunning (no-op, already running) + connect + register + join rooms
        const {client: newClient} = await connectToDaemon({
          clientType: 'tui',
          joinRooms: ['broadcast-room'],
          projectPath: process.cwd(),
        })

        if (!mounted) {
          await newClient.disconnect()
          return
        }

        logTransportEvent('_room', {room: 'broadcast-room', state: 'joined'})

        // Subscribe to connection state changes and re-register event handlers on reconnect
        stateChangeUnsubscribe = newClient.onStateChange((state: ConnectionState) => {
          setConnectionState(state)
          logTransportEvent('_connection', {clientId: newClient.getClientId(), state})
          if (state === 'reconnecting') {
            incrementReconnectCount()
          }

          if (state === 'connected') {
            registerEventHandlers(newClient)
          }
        })

        // Register event handlers for logging
        registerEventHandlers(newClient)

        logTransportEvent('_connection', {clientId: newClient.getClientId(), state: 'initialized'})

        // Set client in store (this also creates apiClient)
        setClient(newClient)
      } catch (error_) {
        if (mounted) {
          const err = error_ instanceof Error ? error_ : new Error(String(error_))
          setError(err)
          logTransportEvent('_connection', {error: err.message, state: 'failed'})
        }
      }
    }

    initializeTransport()

    return () => {
      mounted = false
      if (stateChangeUnsubscribe) {
        stateChangeUnsubscribe()
      }

      // Clean up all event handlers
      for (const unsub of eventUnsubscribes) {
        unsub()
      }

      // Get the current client from store for cleanup
      const {client} = useTransportStore.getState()
      if (client) {
        logTransportEvent('_connection', {state: 'closing'})
        client.disconnect().catch(() => {
          // Ignore errors during cleanup
        })
      }
    }
  }, [incrementReconnectCount, setClient, setConnectionState, setError])

  return <>{children}</>
}
