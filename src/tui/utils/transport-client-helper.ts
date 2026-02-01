import {
  AgentEventNames,
  connectToTransport,
  DaemonInstanceDiscovery,
  type ITransportClient,
  LlmEventList,
  SessionEventNames,
  TaskEventNames,
} from '@campfirein/brv-transport-client'
/**
 * Transport Client Helper for TUI (v0.5.0 architecture).
 *
 * TODO(v0.5.0): This is a temporary helper for TUI team to monitor events.
 * Remove when TUI fully integrates with Transport via React context.
 */
import fs from 'node:fs'
import path from 'node:path'

import {isDevelopment} from '../../server/config/environment.js'
import {BRV_DIR} from '../../server/constants.js'

const TRANSPORT_LOG_FILE = path.join(BRV_DIR, 'transport-events.log')

/**
 * Transport events that TUI subscribes to via "broadcast-room".
 *
 * Event naming convention:
 * - task:* events are Transport-generated (lifecycle)
 * - llmservice:* events are forwarded from Agent with ORIGINAL names
 *
 * This means FE receives the SAME event names that Agent emits internally.
 * No mapping needed - what you see is what Agent does.
 */
const TRANSPORT_EVENTS = [
  // Task lifecycle (Transport-generated) - using constants from package
  TaskEventNames.ACK,
  TaskEventNames.CREATED,
  TaskEventNames.STARTED,
  TaskEventNames.COMPLETED,
  TaskEventNames.ERROR,
  TaskEventNames.CANCELLED,
  // LLM events (using constants from package)
  ...LlmEventList,
  // Connection events (internal)
  AgentEventNames.CONNECTED,
  AgentEventNames.DISCONNECTED,
  SessionEventNames.SWITCHED,
  // Agent control events
  AgentEventNames.RESTARTING,
  AgentEventNames.RESTARTED,
]

function formatTimestamp(): string {
  return new Date().toISOString()
}

function logEvent(eventName: string, data: unknown): void {
  if (!isDevelopment()) return

  const line = JSON.stringify({data, event: eventName, timestamp: formatTimestamp()}, null, 2) + '\n'
  try {
    fs.appendFileSync(TRANSPORT_LOG_FILE, line)
  } catch {
    // Ignore
  }
}

/**
 * Connect to Transport and join TUI room for event monitoring.
 */
export async function connectTransportClient(): Promise<ITransportClient | null> {
  if (isDevelopment()) {
    try {
      fs.writeFileSync(TRANSPORT_LOG_FILE, `# Transport Events - ${formatTimestamp()}\n`)
    } catch {
      // Ignore
    }
  }

  try {
    // Connect to daemon via DaemonInstanceDiscovery (global instance at ~/.local/share/brv/)
    const {client} = await connectToTransport(undefined, {
      discovery: new DaemonInstanceDiscovery(),
    })

    // IMPORTANT: Join broadcast-room FIRST before subscribing to events.
    // This prevents missing events that are broadcast during the subscription window.
    // Pattern inspired by opencode's atomic room join approach.
    await client.joinRoom('broadcast-room')
    logEvent('_room', {room: 'broadcast-room', state: 'joined'})

    // Now subscribe to events - we won't miss any since we're already in the room
    client.onStateChange((state: string) => {
      logEvent('_connection', {clientId: client.getClientId(), state})
    })

    for (const event of TRANSPORT_EVENTS) {
      client.on(event, (data: unknown) => logEvent(event, data))
    }

    logEvent('_connection', {clientId: client.getClientId(), state: 'initialized'})

    return client
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logEvent('_connection', {error: msg, state: 'failed'})
    return null
  }
}

/**
 * Disconnect transport client.
 */
export async function disconnectTransportClient(client: ITransportClient | null): Promise<void> {
  if (client) {
    logEvent('_connection', {state: 'closing'})
    await client.disconnect()
  }
}
