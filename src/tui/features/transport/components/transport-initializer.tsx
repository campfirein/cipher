/**
 * Transport Initializer
 *
 * Initializes transport connection and updates the transport store.
 */

import {type ConnectionState, connectToTransport, type ITransportClient} from '@campfirein/brv-transport-client'
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

        // Use modern connectToTransport API (auto-discovers and connects)
        const {client: newClient} = await connectToTransport()

        if (!mounted) {
          await newClient.disconnect()
          return
        }

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

        // Join broadcast room to receive all events
        await newClient.joinRoom('broadcast-room')
        logTransportEvent('_room', {room: 'broadcast-room', state: 'joined'})

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
