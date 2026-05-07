/**
 * Transport Initializer
 *
 * Connects to the daemon via connectToDaemon() and manages the transport lifecycle.
 * The daemon is already running (ensureDaemonRunning() in main.ts).
 * connectToDaemon() handles: ensure daemon + connect + register + join rooms.
 */

import {
  type ConnectionState,
  connectToDaemon,
  createDaemonReconnector,
  type DaemonReconnectorHandle,
  type ITransportClient,
} from '@campfirein/brv-transport-client'
import React, {useEffect} from 'react'

// eslint-disable-next-line no-restricted-imports -- fallback resolver when store has no projectPath
import {resolveProject} from '../../../../server/infra/project/resolve-project.js'
import {getAllEventValues} from '../../../../shared/transport/events/index.js'
import {initTransportLog, logTransportEvent} from '../../../lib/transport-logger.js'
import {useTransportStore} from '../../../stores/transport-store.js'

interface TransportInitializerProps {
  children: React.ReactNode
}

export function TransportInitializer({children}: TransportInitializerProps): React.ReactNode {
  const {incrementReconnectCount, setClient, setConnectionState, setDaemonVersion, setError} = useTransportStore()

  useEffect(() => {
    let mounted = true
    let reconnectorHandle: DaemonReconnectorHandle | undefined
    let unsubProjectSync: (() => void) | undefined
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

        const getCurrentProjectPath = (): string => {
          const storedProjectPath = useTransportStore.getState().projectPath
          if (storedProjectPath) return storedProjectPath

          // Attempt live resolution as a last resort (e.g. store not yet populated).
          // If resolution fails or returns null, throw — registering with raw cwd
          // would put the client in the wrong room.
          const resolution = resolveProject()
          if (!resolution) {
            throw new Error(
              'No ByteRover project could be resolved. Ensure you are inside a brv project directory.',
            )
          }

          return resolution.projectRoot
        }

        // connectToDaemon = ensureDaemonRunning (no-op, already running) + connect + register + join rooms
        // Use resolved projectPath from store (set by oclif main via resolveProject()),
        // falling back to process.cwd() for backwards compatibility.
        //
        // connectOptions is a mutable object — the reconnector captures it by reference
        // (daemon-reconnector.js line 60), so mutating .projectPath here is visible
        // on subsequent reconnect attempts.
        const connectOptions = {
          clientType: 'tui' as const,
          joinRooms: ['broadcast-room'] as const,
          projectPath: getCurrentProjectPath(),
        }

        // Keep connectOptions.projectPath in sync with the store so reconnects
        // use the latest value (e.g. after reassociation from worktree add/remove).
        // If projectPath is cleared and resolver fails, keep the last good value
        // rather than registering with raw cwd.
        unsubProjectSync = useTransportStore.subscribe((state) => {
          try {
            connectOptions.projectPath = state.projectPath ?? getCurrentProjectPath()
          } catch {
            // Resolver failed — keep existing connectOptions.projectPath unchanged
          }
        })

        const {client: newClient} = await connectToDaemon(connectOptions)

        if (!mounted) {
          await newClient.disconnect()
          return
        }

        logTransportEvent('_room', {room: 'broadcast-room', state: 'joined'})

        // Register event handlers for logging
        registerEventHandlers(newClient)

        logTransportEvent('_connection', {clientId: newClient.getClientId(), state: 'initialized'})

        // Set client in store (this also creates apiClient)
        setClient(newClient)
        // Capture daemon version from register ack so the header can render
        // a drift indicator when the daemon was started by a different brv build.
        setDaemonVersion(newClient.getDaemonVersion?.())

        // Auto-reconnect on disconnect (shared logic from brv-transport-client)
        reconnectorHandle = createDaemonReconnector(newClient, {
          connectOptions,
          onReconnected(reconnectedClient: ITransportClient) {
            if (!mounted) return
            registerEventHandlers(reconnectedClient)
            setClient(reconnectedClient)
            // Refresh on reconnect — the daemon may have been replaced by a
            // peer client at a different version.
            setDaemonVersion(reconnectedClient.getDaemonVersion?.())
            logTransportEvent('_reconnect', {clientId: reconnectedClient.getClientId(), state: 'success'})
          },
          onStateChange(state: ConnectionState, client: ITransportClient) {
            if (!mounted) return
            setConnectionState(state)
            logTransportEvent('_connection', {clientId: client.getClientId(), state})
            if (state === 'reconnecting') {
              incrementReconnectCount()
            }

            if (state === 'connected') {
              registerEventHandlers(client)
            }
          },
        })
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
      reconnectorHandle?.cancel()
      unsubProjectSync?.()

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
  }, [incrementReconnectCount, setClient, setConnectionState, setDaemonVersion, setError])

  return <>{children}</>
}
