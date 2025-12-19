/**
 * Transport Client Helper for TUI (v0.5.0 architecture).
 *
 * TODO(v0.5.0): This is a temporary helper for TUI team to monitor events.
 * Remove when TUI fully integrates with Transport via React context.
 */
import fs from 'node:fs'
import path from 'node:path'

import type {ITransportClient} from '../../core/interfaces/transport/i-transport-client.js'

import {BRV_DIR} from '../../constants.js'
import {createTransportClientFactory} from '../transport/transport-client-factory.js'

const TRANSPORT_LOG_FILE = path.join(BRV_DIR, 'transport-events.log')

/**
 * Transport events that TUI subscribes to via "tui" room.
 */
const TRANSPORT_EVENTS = [
  'task:ack',
  'task:started',
  'task:chunk',
  'task:completed',
  'task:error',
  'task:toolCall',
  'task:toolResult',
  'agent:connected',
  'agent:disconnected',
  'session:switched',
]

function formatTimestamp(): string {
  return new Date().toISOString()
}

function logEvent(eventName: string, data: unknown): void {
  const line = JSON.stringify({data, event: eventName, timestamp: formatTimestamp()}) + '\n'
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
  try {
    fs.writeFileSync(TRANSPORT_LOG_FILE, `# Transport Events - ${formatTimestamp()}\n`)
  } catch {
    // Ignore
  }

  try {
    const factory = createTransportClientFactory()
    const {client} = await factory.connect()

    client.onStateChange((state: string) => {
      logEvent('_connection', {clientId: client.getClientId(), state})
    })

    for (const event of TRANSPORT_EVENTS) {
      client.on(event, (data: unknown) => logEvent(event, data))
    }

    logEvent('_connection', {clientId: client.getClientId(), state: 'initialized'})

    await client.joinRoom('tui')
    logEvent('_room', {room: 'tui', state: 'joined'})

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
