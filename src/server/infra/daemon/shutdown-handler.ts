import type {IDaemonResilience} from '../../core/interfaces/daemon/i-daemon-resilience.js'
import type {IGlobalInstanceManager} from '../../core/interfaces/daemon/i-global-instance-manager.js'
import type {IHeartbeatWriter} from '../../core/interfaces/daemon/i-heartbeat-writer.js'
import type {IIdleTimeoutPolicy} from '../../core/interfaces/daemon/i-idle-timeout-policy.js'
import type {IShutdownHandler} from '../../core/interfaces/daemon/i-shutdown-handler.js'
import type {ITransportServer} from '../../core/interfaces/transport/i-transport-server.js'

export interface ShutdownHandlerDeps {
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
 * 3. Stop heartbeat writer (deletes heartbeat file)
 * 4. Stop transport server (disconnect sockets, close HTTP server)
 * 5. Release instance.json
 * 6. Schedule force exit safety net
 *
 * Transport is stopped BEFORE releasing instance.json to prevent
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

    // 3. Stop heartbeat (deletes file)
    try {
      heartbeatWriter.stop()
    } catch (error) {
      log(`Error stopping heartbeat: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 4. Stop transport server (disconnect all sockets, close HTTP)
    try {
      await transportServer.stop()
    } catch (error) {
      log(`Error stopping transport: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 5. Release instance.json
    try {
      instanceManager.release()
    } catch (error) {
      log(`Error releasing instance: ${error instanceof Error ? error.message : String(error)}`)
    }

    log('Shutdown complete')

    // Safety net: force exit if event loop hasn't drained
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    setTimeout(() => process.exit(0), 5000).unref()
  }
}
