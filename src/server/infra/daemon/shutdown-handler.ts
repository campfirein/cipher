import type {IAgentPool} from '../../core/interfaces/agent/i-agent-pool.js'
import type {IDaemonResilience} from '../../core/interfaces/daemon/i-daemon-resilience.js'
import type {IGlobalInstanceManager} from '../../core/interfaces/daemon/i-global-instance-manager.js'
import type {IHeartbeatWriter} from '../../core/interfaces/daemon/i-heartbeat-writer.js'
import type {IIdleTimeoutPolicy} from '../../core/interfaces/daemon/i-idle-timeout-policy.js'
import type {IShutdownHandler} from '../../core/interfaces/daemon/i-shutdown-handler.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

import {SHUTDOWN_FORCE_EXIT_MS, TRANSPORT_STOP_TIMEOUT_MS} from '../../constants.js'

export interface ShutdownHandlerDeps {
  readonly agentPool?: IAgentPool
  readonly daemonResilience: IDaemonResilience
  readonly heartbeatWriter: IHeartbeatWriter
  readonly idleTimeoutPolicy: IIdleTimeoutPolicy
  readonly instanceManager: IGlobalInstanceManager
  readonly log: (message: string) => void
  readonly transportServer: ITransportServer
}

/**
 * Ordered graceful shutdown handler for the daemon.
 *
 * Shutdown sequence:
 * 1. Stop idle timeout checks
 * 2. Uninstall resilience handlers
 * 3. Stop heartbeat writer (stops writes, file becomes stale naturally)
 * 4. Stop agent pool (SIGTERM child processes, wait for exit)
 * 5. Stop transport server (disconnect sockets, close HTTP server)
 * 6. Release daemon.json
 * 7. Schedule force exit safety net
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

    const {daemonResilience, heartbeatWriter, idleTimeoutPolicy, instanceManager, log, transportServer} = this.deps

    log('Shutdown initiated')

    // 1. Stop idle timeout checks
    try {
      idleTimeoutPolicy.stop()
    } catch (error) {
      log(`Error stopping idle timeout: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 2. Uninstall resilience handlers
    try {
      daemonResilience.uninstall()
    } catch (error) {
      log(`Error uninstalling resilience: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 3. Stop heartbeat (file becomes stale naturally)
    try {
      heartbeatWriter.stop()
    } catch (error) {
      log(`Error stopping heartbeat: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 4. Stop agent pool (SIGTERM all child processes, wait for exit)
    //    Must happen before transport server stops — agents need the
    //    transport connection for graceful shutdown signaling.
    if (this.deps.agentPool) {
      try {
        await this.deps.agentPool.shutdown()
      } catch (error) {
        log(`Error shutting down agent pool: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 5. Stop transport server (disconnect all sockets, close HTTP)
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

    // 6. Release daemon.json
    try {
      instanceManager.release()
    } catch (error) {
      log(`Error releasing instance: ${error instanceof Error ? error.message : String(error)}`)
    }

    log('Shutdown complete')

    // Safety net: force exit if event loop hasn't drained
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    setTimeout(() => process.exit(0), SHUTDOWN_FORCE_EXIT_MS).unref()
  }
}
