/**
 * Daemon entry point — standalone Node.js process.
 *
 * This file is spawned as a detached child process by any client
 * (TUI, MCP, CLI) via `brv-transport-client`. It does NOT depend
 * on oclif or any CLI framework.
 *
 * Startup sequence:
 * 1. Setup daemon logging
 * 2. Select port (prefer 37847, fallback 37848-37947)
 * 3. Acquire global instance lock (atomic temp+rename)
 * 4. Start Socket.IO transport server
 * 5. Start heartbeat writer
 * 6. Install daemon resilience handlers
 * 7. Create idle timeout policy
 * 8. Create shutdown handler
 * 9. Start idle timer
 * 10. Register signal handlers
 */

import {mkdirSync, readdirSync, readFileSync, unlinkSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

import {HEARTBEAT_FILE} from '../../constants.js'
import {getGlobalDataDir} from '../../utils/global-data-path.js'
import {crashLog, processLog} from '../../utils/process-logger.js'
import {createTransportServer} from '../transport/transport-factory.js'
import {DaemonResilience} from './daemon-resilience.js'
import {GlobalInstanceManager} from './global-instance-manager.js'
import {HeartbeatWriter} from './heartbeat.js'
import {IdleTimeoutPolicy} from './idle-timeout-policy.js'
import {selectDaemonPort} from './port-selector.js'
import {ShutdownHandler} from './shutdown-handler.js'

function log(msg: string): void {
  processLog(`[Daemon] ${msg}`)
}

/**
 * Reads the CLI version from package.json.
 * Walks up from the compiled file location to find the project root.
 */
function readCliVersion(): string {
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url))
    // Both src/ and dist/ are 4 levels deep: server/infra/daemon/server-main
    const pkgPath = join(currentDir, '..', '..', '..', '..', 'package.json')
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string') {
      return pkg.version
    }
  } catch {
    // Best-effort — return fallback
  }

  return 'unknown'
}

/**
 * Removes old daemon log files, keeping the most recent ones.
 * Filenames are timestamp-based (`server-YYYY-MM-DDTHH-MM-SS.log`),
 * so alphabetical sort = chronological order.
 */
function cleanupOldLogs(logsDir: string, keep: number): void {
  try {
    const files = readdirSync(logsDir)
      .filter((f) => f.startsWith('server-') && f.endsWith('.log'))
      .sort()

    if (files.length <= keep) return

    const toDelete = files.slice(0, files.length - keep)
    for (const file of toDelete) {
      try {
        unlinkSync(join(logsDir, file))
      } catch {
        // Best-effort per file
      }
    }
  } catch {
    // Best-effort — don't block daemon startup
  }
}

async function main(): Promise<void> {
  // 1. Setup daemon logging at ~/.local/share/brv/logs/server-<timestamp>.log
  const daemonLogsDir = join(getGlobalDataDir(), 'logs')
  mkdirSync(daemonLogsDir, {recursive: true})
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 19)
  process.env.BRV_SESSION_LOG = join(daemonLogsDir, `server-${timestamp}.log`)

  // Best-effort cleanup of old daemon log files (keep last 10)
  cleanupOldLogs(daemonLogsDir, 10)

  log('Starting daemon...')

  // 2. Select port (prefer 37847, fallback 37848-37947)
  const portResult = await selectDaemonPort()
  if (!portResult.success) {
    log('Failed to find available port for daemon (all ports 37847-37947 occupied)')
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }

  const {port} = portResult
  log(`Selected port ${port}`)

  // 3. Acquire global instance lock (atomic temp+rename)
  const version = readCliVersion()
  const instanceManager = new GlobalInstanceManager()
  const acquireResult = instanceManager.acquire(port, version)
  if (!acquireResult.acquired) {
    if (acquireResult.reason === 'already_running') {
      log(
        `Another daemon already running (PID: ${acquireResult.existingInstance.pid}, port: ${acquireResult.existingInstance.port})`,
      )
    } else {
      log(`Failed to acquire instance lock: ${acquireResult.reason}`)
    }

    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(1)
  }

  log(`Instance acquired (PID: ${process.pid}, port: ${port})`)

  // Steps 4-10 are wrapped so that partial startup is cleaned up.
  // Without this, a partial startup leaves daemon.json pointing to
  // a dead PID and may leak the port until stale-detection kicks in.
  //
  // Hoisted so the catch block can stop whatever was started.
  let transportServer: ReturnType<typeof createTransportServer> | undefined
  let heartbeatWriter: HeartbeatWriter | undefined

  try {
    // 4. Start Socket.IO transport server
    transportServer = createTransportServer()
    await transportServer.start(port)
    log(`Transport server started on port ${port}`)

    // 5. Start heartbeat writer
    const heartbeatPath = join(getGlobalDataDir(), HEARTBEAT_FILE)
    heartbeatWriter = new HeartbeatWriter({
      filePath: heartbeatPath,
      log,
    })
    heartbeatWriter.start()

    // 6. Install daemon resilience (crash/signal/sleep handlers)
    const daemonResilience = new DaemonResilience({
      crashLog,
      log,
      onWake() {
        log('Wake from sleep detected — refreshing heartbeat')
        heartbeatWriter?.refresh()
      },
    })
    daemonResilience.install()

    // 7. Create idle timeout policy + wire transport events
    const idleTimeoutPolicy = new IdleTimeoutPolicy({log})

    transportServer.onConnection((clientId, metadata) => {
      log(`Client connected: ${clientId}, cwd=${metadata.cwd ?? 'unknown'}`)
      idleTimeoutPolicy.onClientConnected()
    })
    transportServer.onDisconnection((clientId) => {
      log(`Client disconnected: ${clientId}`)
      idleTimeoutPolicy.onClientDisconnected()
    })

    // 8. Create shutdown handler
    const shutdownHandler = new ShutdownHandler({
      daemonResilience,
      heartbeatWriter,
      idleTimeoutPolicy,
      instanceManager,
      log,
      transportServer,
    })

    // 9. Wire idle callback + start idle timer
    idleTimeoutPolicy.setOnIdle(() => {
      log('Idle timeout reached — initiating shutdown')
      shutdownHandler.shutdown().catch((error: unknown) => {
        log(`Shutdown error: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
    idleTimeoutPolicy.start()

    // 10. Register signal handlers (once to prevent duplicate handling)
    process.once('SIGTERM', () => {
      log('SIGTERM received')
      shutdownHandler.shutdown().catch((error: unknown) => {
        log(`Shutdown error: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
    process.once('SIGINT', () => {
      log('SIGINT received')
      shutdownHandler.shutdown().catch((error: unknown) => {
        log(`Shutdown error: ${error instanceof Error ? error.message : String(error)}`)
      })
    })

    log(`Daemon fully started (PID: ${process.pid}, port: ${port})`)
  } catch (error: unknown) {
    // Best-effort cleanup of anything started before the failure.
    // Each step is independent — continue cleanup even if one throws.
    heartbeatWriter?.stop()
    await transportServer?.stop().catch(() => {})
    instanceManager.release()
    throw error
  }
}

// Run the daemon
try {
  await main()
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  processLog(`[Daemon] Fatal startup error: ${message}`)
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
  process.exit(1)
}
