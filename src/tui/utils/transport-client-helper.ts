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
import {ensureDaemonRunning} from '../../server/infra/daemon/daemon-spawner.js'
import {detectMcpMode} from '../../server/infra/mcp/mcp-mode-detector.js'

const TRANSPORT_LOG_FILE = path.join(BRV_DIR, 'transport-events.log')

/**
 * Transport events that TUI subscribes to.
 *
 * Task/LLM events arrive via the project-scoped room (server adds TUI on registration).
 * Global events (auth, agent connect/disconnect) arrive via broadcast-room.
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
    // Connect to daemon (auto-start if needed) with auto-registration as 'tui'
    const {projectRoot} = detectMcpMode(process.cwd())
    const daemonResult = await ensureDaemonRunning()
    if (!daemonResult.success) {
      const detail = daemonResult.spawnError ? `: ${daemonResult.spawnError}` : ''
      throw new Error(`Failed to start daemon: timed out waiting for daemon to become ready${detail}`)
    }

    const {client} = await connectToTransport(process.cwd(), {
      clientType: 'tui',
      discovery: new DaemonInstanceDiscovery(),
      // Register with projectPath so the server adds TUI to the project room.
      // Task/LLM events are broadcast to the project room (not global broadcast-room).
      ...(projectRoot ? {projectPath: projectRoot} : {}),
    })
    logEvent('_registration', {projectPath: projectRoot, state: 'auto-registered'})

    // Join broadcast-room for global events (auth:updated, auth:expired, agent connect/disconnect).
    // Task/LLM events come via the project room (joined server-side on registration).
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
