import {ensureDaemonRunning} from '@campfirein/brv-transport-client'
import {Command} from '@oclif/core'

import {FileGlobalConfigStore} from '../../server/infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../server/infra/storage/token-store.js'
import {MixpanelTrackingService} from '../../server/infra/tracking/mixpanel-tracking-service.js'
import {initSessionLog, processManagerLog} from '../../server/utils/process-logger.js'
import {resolveLocalServerMainPath} from '../../server/utils/server-main-resolver.js'
import {startRepl} from '../../tui/repl-startup.js'

/**
 * Main command - Entry point for ByteRover CLI.
 *
 * Ensures the global daemon is running, then starts the interactive REPL.
 * The daemon manages the transport server and agent pool (forked child processes).
 * TUI connects to the daemon via TransportClientFactory.
 */
export default class Main extends Command {
  public static description = 'ByteRover CLI - Interactive REPL'
  /**
   *  Hide from help listing since this is the default command (only 'brv')
   */
  public static hidden = true

  public async run(): Promise<void> {
    // Initialize session log (creates ~/.brv/logs/brv-{timestamp}.log)
    initSessionLog()

    // Check if running in an interactive terminal
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.log('ByteRover REPL requires an interactive terminal.')
      this.log("Run 'brv --help' for available commands.")
      return
    }

    // Pre-flight: ensure daemon is running (spawn if needed, restart on version mismatch)
    const daemonResult = await ensureDaemonRunning({
      serverPath: resolveLocalServerMainPath(),
      version: this.config.version,
    })
    if (!daemonResult.success) {
      const detail = daemonResult.spawnError ? `: ${daemonResult.spawnError}` : ''
      this.error(`Failed to start daemon: timed out waiting for daemon to become ready${detail}`)
    }

    processManagerLog(
      `Daemon ready (pid=${daemonResult.info.pid}, port=${daemonResult.info.port}, started=${daemonResult.started})`,
    )

    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

    // Start the interactive REPL (TUI connects via connectToDaemon internally)
    await startRepl({
      trackingService,
      version: this.config.version,
    })
  }
}
