import type {IGlobalInstanceManager} from '@campfirein/brv-transport-client'

import type {IAgentPool} from '../../core/interfaces/agent/i-agent-pool.js'
import type {IAgentIdleTimeoutPolicy} from '../../core/interfaces/daemon/i-agent-idle-timeout-policy.js'
import type {IDaemonResilience} from '../../core/interfaces/daemon/i-daemon-resilience.js'
import type {IHeartbeatWriter} from '../../core/interfaces/daemon/i-heartbeat-writer.js'
import type {IIdleTimeoutPolicy} from '../../core/interfaces/daemon/i-idle-timeout-policy.js'
import type {IShutdownHandler} from '../../core/interfaces/daemon/i-shutdown-handler.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

import {SHUTDOWN_FORCE_EXIT_MS, TRANSPORT_STOP_TIMEOUT_MS} from '../../constants.js'
import {removeWebuiState} from '../webui/webui-state.js'

interface IWebUiServer {
  isRunning(): boolean
  stop(): Promise<void>
}

export interface ShutdownHandlerDeps {
  readonly agentIdleTimeoutPolicy?: IAgentIdleTimeoutPolicy
  readonly agentPool?: IAgentPool
  readonly daemonResilience: IDaemonResilience
  readonly heartbeatWriter: IHeartbeatWriter
  readonly idleTimeoutPolicy: IIdleTimeoutPolicy
  readonly instanceManager: IGlobalInstanceManager
  readonly log: (message: string) => void
  readonly transportServer: ITransportServer
  readonly webuiServer?: IWebUiServer
}

/**
 * Ordered graceful shutdown handler for the daemon.
 *
 * Shutdown sequence (9 steps):
 * 1. Stop server idle timeout checks
 * 2. Stop agent idle timeout checks
 * 3. Uninstall resilience handlers
 * 4. Stop heartbeat writer (stops writes, file becomes stale naturally)
 * 5. Stop agent pool (SIGTERM child processes, wait for exit)
 * 6. Stop transport server (disconnect sockets, close HTTP server)
 * 7. Stop web UI server + remove webui.json
 * 8. Release daemon.json
 * 9. Schedule force exit safety net
 *
 * Agent pool is stopped BEFORE transport server so agents can use
 * their transport connections for graceful shutdown signaling.
 * Transport is stopped BEFORE releasing daemon.json to prevent
 * another daemon binding the same port while sockets are still closing.
 */
export class ShutdownHandler implements IShutdownHandler {
  private readonly deps: ShutdownHandlerDeps
  private isShuttingDown = false

  constructor(deps: ShutdownHandlerDeps) {
    this.deps = deps
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return
    this.isShuttingDown = true

    const {
      agentIdleTimeoutPolicy,
      daemonResilience,
      heartbeatWriter,
      idleTimeoutPolicy,
      instanceManager,
      log,
      transportServer,
    } = this.deps

    log('Shutdown initiated')

    // Step 1. Stop idle timeout checks (server-level)
    try {
      idleTimeoutPolicy.stop()
    } catch (error) {
      log(`Error stopping idle timeout: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Step 2. Stop agent idle timeout checks
    if (agentIdleTimeoutPolicy) {
      try {
        agentIdleTimeoutPolicy.stop()
      } catch (error) {
        log(`Error stopping agent idle timeout: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Step 3. Uninstall resilience handlers
    try {
      daemonResilience.uninstall()
    } catch (error) {
      log(`Error uninstalling resilience: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Step 4. Stop heartbeat (file becomes stale naturally)
    try {
      heartbeatWriter.stop()
    } catch (error) {
      log(`Error stopping heartbeat: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Step 5. Stop agent pool (SIGTERM all child processes, wait for exit)
    //    Must happen before transport server stops — agents need the
    //    transport connection for graceful shutdown signaling.
    if (this.deps.agentPool) {
      try {
        await this.deps.agentPool.shutdown()
      } catch (error) {
        log(`Error shutting down agent pool: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Step 6. Stop transport server (disconnect all sockets, close HTTP)
    //    Wrapped in Promise.race with timeout to prevent hanging — if Socket.IO
    //    blocks (e.g., waiting for in-flight responses), we proceed with remaining
    //    cleanup steps instead of relying solely on the force-exit safety net
    //    (which would skip instance lock release via process.exit).
    try {
      await Promise.race([
        transportServer.stop(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, TRANSPORT_STOP_TIMEOUT_MS)
        }),
      ])
    } catch (error) {
      log(`Error stopping transport: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Step 7. Stop web UI server + remove state file
    if (this.deps.webuiServer?.isRunning()) {
      try {
        await this.deps.webuiServer.stop()
      } catch (error) {
        log(`Error stopping web UI server: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    removeWebuiState()

    // Step 8. Release daemon.json
    try {
      instanceManager.release()
    } catch (error) {
      log(`Error releasing instance: ${error instanceof Error ? error.message : String(error)}`)
    }

    log('Shutdown complete')

    // Step 9. Safety net: force exit if event loop hasn't drained
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    setTimeout(() => process.exit(0), SHUTDOWN_FORCE_EXIT_MS).unref()
  }
}
