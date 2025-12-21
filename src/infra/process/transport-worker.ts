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

import {type FSWatcher, watch} from 'node:fs'
import {join} from 'node:path'

import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'
import type {IPCCommand, TransportIPCResponse} from './ipc-types.js'

import {BRV_DIR, INSTANCE_FILE} from '../../constants.js'
import {transportLog} from '../../utils/process-logger.js'
import {FileInstanceManager} from '../instance/file-instance-manager.js'
import {findAvailablePort} from '../transport/port-utils.js'
import {createTransportServer} from '../transport/transport-factory.js'
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
let instanceWatcher: FSWatcher | undefined
const instanceManager = new FileInstanceManager()

/**
 * Setup file watcher to detect instance.json deletion and recreate it.
 * This handles the case where /init or other commands delete .brv/ folder
 * while Transport is still running.
 */
function setupInstanceWatcher(projectRoot: string, port: number): void {
  const brvDir = join(projectRoot, BRV_DIR)
  const instanceFileName = INSTANCE_FILE

  try {
    instanceWatcher = watch(brvDir, async (eventType, filename) => {
      // Only care about instance.json changes
      if (filename !== instanceFileName) return

      // Check if instance.json was deleted (rename event on deletion)
      if (eventType === 'rename') {
        // Small delay to avoid race with file operations
        await new Promise((resolve) => {
          setTimeout(resolve, 100)
        })

        // Try to recreate instance.json
        try {
          const result = await instanceManager.acquire(projectRoot, port)
          if (result.acquired) {
            transportLog('instance.json was deleted - recreated successfully')
          }
        } catch (error) {
          // .brv directory might not exist yet, will be recreated by init
          transportLog(`Could not recreate instance.json: ${error}`)
        }
      }
    })

    instanceWatcher.on('error', (error) => {
      transportLog(`Instance watcher error: ${error.message}`)
      // Watcher might fail if .brv/ is deleted, try to restart it
      restartInstanceWatcher(projectRoot, port)
    })

    transportLog('Instance file watcher started')
  } catch {
    // .brv directory might not exist, will setup watcher later
    transportLog('Could not setup instance watcher (directory may not exist)')
  }
}

/**
 * Restart the instance watcher after an error or directory recreation.
 */
function restartInstanceWatcher(projectRoot: string, port: number): void {
  // Close existing watcher
  if (instanceWatcher) {
    instanceWatcher.close()
    instanceWatcher = undefined
  }

  // Wait a bit for directory to be recreated, then try to restart
  setTimeout(async () => {
    // First: recreate instance.json (this also creates .brv/ if needed)
    try {
      const result = await instanceManager.acquire(projectRoot, port)
      if (result.acquired) {
        transportLog('instance.json recreated after directory deletion')
      }
    } catch (error) {
      transportLog(`Failed to recreate instance.json: ${error}`)
    }

    // Then: setup watcher (now .brv/ should exist)
    setupInstanceWatcher(projectRoot, port)
  }, 500)
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
  transportHandlers = new TransportHandlers(transportServer)
  transportHandlers.setup()

  // Setup watcher to recreate instance.json if deleted
  setupInstanceWatcher(projectRoot, port)

  transportLog(`Socket.IO server started on port ${port}`)
  transportLog(`Instance registered at ${projectRoot}/.brv/instance.json`)
  return port
}

async function stopTransport(): Promise<void> {
  // Close instance watcher first
  if (instanceWatcher) {
    instanceWatcher.close()
    instanceWatcher = undefined
  }

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    transportLog(`Failed to start: ${message}`)
    sendToParent({error: message, type: 'error'})
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
  process.on('disconnect', cleanup)
}

// ============================================================================
// Run
// ============================================================================

try {
  await runWorker()
} catch (error) {
  transportLog(`Fatal error: ${error}`)
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}
