/**
 * Transport Worker - Entry point for Transport Process.
 *
 * Architecture v0.5.0:
 * - ONLY runs Socket.IO server (message hub)
 * - Routes messages between clients (TUI, external CLIs) and Agent
 * - NO TaskProcessor, NO CipherAgent, NO UseCases
 * - Detects Agent connect/disconnect → broadcasts to clients
 *
 * IPC messages:
 * - Receives: 'ping', 'shutdown'
 * - Sends: 'ready' (with port), 'pong', 'stopped', 'error'
 *
 * Socket.IO events:
 * - Client → Transport: task:create, task:cancel, session:*
 * - Transport → Agent: task:create, task:cancel, shutdown
 * - Agent → Transport: task:started, task:chunk, task:completed, task:error, task:toolCall, task:toolResult
 * - Transport → Client: task:ack, task:started, task:chunk, task:completed, task:error, agent:connected, agent:disconnected
 */

import {existsSync} from 'node:fs'
import {join} from 'node:path'

import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'
import type {IPCCommand, TransportIPCResponse} from './ipc-types.js'

import {BRV_DIR, INSTANCE_FILE} from '../../constants.js'
import {transportLog} from '../../utils/process-logger.js'
import {FileInstanceManager} from '../instance/file-instance-manager.js'
import {ProjectRouter} from '../routing/project-router.js'
import {findAvailablePort} from '../transport/port-utils.js'
import {createTransportServer} from '../transport/transport-factory.js'
import {createParentHeartbeat} from './parent-heartbeat.js'
import {TransportHandlers} from './transport-handlers.js'

// IPC types imported from ./ipc-types.ts

function sendToParent(message: TransportIPCResponse): void {
  process.send?.(message)
}

// ============================================================================
// Transport Process
// ============================================================================

let transportServer: ITransportServer | undefined
let transportHandlers: TransportHandlers | undefined
let instancePollingInterval: ReturnType<typeof setInterval> | undefined
let parentHeartbeat: ReturnType<typeof createParentHeartbeat> | undefined
const instanceManager = new FileInstanceManager()

/** Polling interval in milliseconds */
const INSTANCE_POLLING_INTERVAL_MS = 2000

/**
 * Setup polling to detect instance.json deletion and recreate it.
 *
 * Why polling instead of fs.watch()?
 * - fs.watch() on .brv/ directory silently stops when the directory is deleted
 * - /init deletes entire .brv/ folder, causing watcher to become a dead listener
 * - Polling is more reliable for this self-healing use case
 */
function setupInstancePolling(projectRoot: string, port: number): void {
  const instancePath = join(projectRoot, BRV_DIR, INSTANCE_FILE)

  instancePollingInterval = setInterval(async () => {
    // Check if instance.json exists
    if (!existsSync(instancePath)) {
      // Check if .brv directory exists (init might have recreated it)
      const brvDir = join(projectRoot, BRV_DIR)
      if (existsSync(brvDir)) {
        // .brv exists but instance.json doesn't - recreate it
        try {
          const result = await instanceManager.acquire(projectRoot, port)
          if (result.acquired) {
            transportLog('instance.json was deleted - recreated successfully')
          }
        } catch (error) {
          transportLog(`Could not recreate instance.json: ${error}`)
        }
      }
      // If .brv doesn't exist, wait for /init to create it
    }
  }, INSTANCE_POLLING_INTERVAL_MS)

  transportLog('Instance self-healing polling started')
}

/**
 * Stop the instance polling.
 */
function stopInstancePolling(): void {
  if (instancePollingInterval) {
    clearInterval(instancePollingInterval)
    instancePollingInterval = undefined
  }
}

async function startTransport(): Promise<number> {
  // Create Socket.IO server
  transportServer = createTransportServer()

  // Find available port
  const port = await findAvailablePort()

  // Start server
  await transportServer.start(port)

  // Write instance.json for discovery by clients (TUI, external CLIs)
  const projectRoot = process.cwd()
  const acquireResult = await instanceManager.acquire(projectRoot, port)
  if (!acquireResult.acquired) {
    throw new Error(
      'brv is already running in this directory. ' +
        'Please close the other instance first, or use a different terminal.',
    )
  }

  // Setup message handlers (routing between clients and Agent)
  const projectRouter = new ProjectRouter({transport: transportServer})
  transportHandlers = new TransportHandlers(transportServer, projectRouter)
  transportHandlers.setup()

  // Setup polling to recreate instance.json if deleted
  setupInstancePolling(projectRoot, port)

  transportLog(`Socket.IO server started on port ${port}`)
  transportLog(`Instance registered at ${projectRoot}/.brv/instance.json`)
  return port
}

async function stopTransport(): Promise<void> {
  // Stop heartbeat and polling first
  parentHeartbeat?.stop()
  stopInstancePolling()

  // Release instance.json
  const projectRoot = process.cwd()
  await instanceManager.release(projectRoot)

  if (transportHandlers) {
    transportHandlers.cleanup()
    transportHandlers = undefined
  }

  if (transportServer) {
    await transportServer.stop()
    transportServer = undefined
  }

  transportLog('Socket.IO server stopped')
}

// ============================================================================
// Worker Entry Point
// ============================================================================

async function runWorker(): Promise<void> {
  try {
    const port = await startTransport()
    sendToParent({port, type: 'ready'})

    // Start parent heartbeat monitoring after ready
    // This ensures we self-terminate if parent dies (SIGKILL scenario)
    parentHeartbeat = createParentHeartbeat({
      cleanup: stopTransport,
      log: transportLog,
      preCleanup: stopInstancePolling,
    })
    parentHeartbeat.start()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    transportLog(`Failed to start: ${message}`)
    sendToParent({error: message, type: 'error'})
    // Cleanup before exit to release any acquired resources
    await stopTransport().catch(() => {})
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }

  // IPC message handler
  process.on('message', async (msg: IPCCommand) => {
    if (msg.type === 'ping') {
      sendToParent({type: 'pong'})
    } else if (msg.type === 'shutdown') {
      await stopTransport()
      sendToParent({type: 'stopped'})
      // eslint-disable-next-line n/no-process-exit
      process.exit(0)
    }
  })

  // Signal handlers
  const cleanup = async (): Promise<void> => {
    await stopTransport()
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(0)
  }

  process.once('SIGTERM', cleanup)
  process.once('SIGINT', cleanup)
  process.once('disconnect', cleanup)

  // Global exception handlers - ensure cleanup on unexpected errors
  process.on('uncaughtException', async (error) => {
    transportLog(`Uncaught exception: ${error}`)
    await stopTransport().catch(() => {})
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })

  process.on('unhandledRejection', async (reason) => {
    transportLog(`Unhandled rejection: ${reason}`)
    await stopTransport().catch(() => {})
    // eslint-disable-next-line n/no-process-exit
    process.exit(1)
  })
}

// ============================================================================
// Run
// ============================================================================

try {
  await runWorker()
} catch (error) {
  transportLog(`Fatal error: ${error}`)
  // Cleanup before exit to release any acquired resources
  await stopTransport().catch(() => {})
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}
