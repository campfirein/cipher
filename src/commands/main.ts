import {Command} from '@oclif/core'

import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {startRepl} from '../infra/repl/repl-startup.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'

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

    // Start the interactive REPL
    await startRepl({
      projectConfigStore: new ProjectConfigStore(),
      tokenStore: new KeychainTokenStore(),
      version: this.config.version,
    })
  }
}
