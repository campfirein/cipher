import {Command} from '@oclif/core'

import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {getProcessManager} from '../infra/process/index.js'
import {startRepl} from '../infra/repl/repl-startup.js'
import {FileGlobalConfigStore} from '../infra/storage/file-global-config-store.js'
import {FileOnboardingPreferenceStore} from '../infra/storage/file-onboarding-preference-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'

/**
 * Main command - Entry point for ByteRover CLI.
 *
 * Architecture v0.5.0:
 * - Main Process: Spawns Transport and Agent processes
 * - TUI discovers Transport via TransportClientFactory (same as external CLIs)
 * - All task communication via Socket.IO (NO IPC)
 */
export default class Main extends Command {
  public static description = 'ByteRover CLI - Interactive REPL'
  /**
   *  Hide from help listing since this is the default command (only 'brv')
   */
  public static hidden = true

  public async run(): Promise<void> {
    // Check if running in an interactive terminal
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.log('ByteRover REPL requires an interactive terminal.')
      this.log("Run 'brv --help' for available commands.")
      return
    }

    // Start Transport and Agent processes (v0.5.0 architecture)
    const processManager = getProcessManager()
    await processManager.start()

    const tokenStore = new KeychainTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
    const onboardingPreferenceStore = new FileOnboardingPreferenceStore()

    // Start the interactive REPL
    // TUI will discover Transport via TransportClientFactory (same as external CLIs)
    try {
      await startRepl({
        onboardingPreferenceStore,
        projectConfigStore: new ProjectConfigStore(),
        tokenStore,
        trackingService,
        version: this.config.version,
      })
    } finally {
      await processManager.stop()
    }
  }
}
