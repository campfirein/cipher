import {Command, Flags} from '@oclif/core'

import {ConsoleLogger} from '../infra/cipher/logger/console-logger.js'
import {CoreProcess} from '../infra/core/core-process.js'

export default class Start extends Command {
  public static description = 'Start ByteRover Core process (Transport server)'
  public static examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --port 9847']
  public static flags = {
    port: Flags.integer({
      char: 'p',
      description: 'Preferred port (will fallback to random if unavailable)',
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Start)

    const logger = new ConsoleLogger({verbose: true})
    const core = new CoreProcess({
      logger,
      preferredPort: flags.port,
      projectRoot: process.cwd(),
    })

    try {
      await core.start()

      const state = core.getState()
      logger.info('Core process started', {port: state.port})
      logger.info('Instance file written', {path: '.brv/instance.json'})
      logger.info('Press Ctrl+C to stop')

      // Keep process alive
      await new Promise<void>(() => {
        // Process will be kept alive until signal handler triggers
      })
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message)
      }

      throw error
    }
  }
}
