import {Command, Flags} from '@oclif/core'

import type {
  ConfirmOptions,
  FileSelectorItem,
  FileSelectorOptions,
  InputOptions,
  ITerminal,
  SearchOptions,
  SelectOptions,
} from '../core/interfaces/i-terminal.js'

import {ConsoleLogger} from '../infra/cipher/logger/console-logger.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {CoreProcess} from '../infra/core/core-process.js'
import {createTaskProcessor} from '../infra/core/task-processor.js'
import {FileGlobalConfigStore} from '../infra/storage/file-global-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {CurateUseCase} from '../infra/usecase/curate-use-case.js'
import {QueryUseCase} from '../infra/usecase/query-use-case.js'

/**
 * NoOp Terminal for headless mode.
 * Transport mode uses callbacks instead of terminal output.
 */
class NoOpTerminal implements ITerminal {
  actionStart(_message: string): void {
    // No-op
  }

  actionStop(_message?: string): void {
    // No-op
  }

  confirm(_options: ConfirmOptions): Promise<boolean> {
    return Promise.reject(new Error('Interactive confirmation not available in headless mode'))
  }

  error(_message: string): void {
    // No-op - errors go through callbacks
  }

  fileSelector(_options: FileSelectorOptions): Promise<FileSelectorItem | null> {
    return Promise.resolve(null)
  }

  input(_options: InputOptions): Promise<string> {
    return Promise.resolve('')
  }

  log(_message?: string): void {
    // No-op - output goes through callbacks
  }

  search<T>(_options: SearchOptions<T>): Promise<T> {
    return Promise.reject(new Error('Interactive search not available in headless mode'))
  }

  select<T>(_options: SelectOptions<T>): Promise<T> {
    return Promise.reject(new Error('Interactive selection not available in headless mode'))
  }

  warn(_message: string): void {
    // No-op
  }
}

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

    // Load auth token
    const tokenStore = new KeychainTokenStore()
    const token = await tokenStore.load()

    if (!token) {
      this.error('Not authenticated. Please run "brv login" first.', {exit: 1})
    }

    // Load project config
    const projectConfigStore = new ProjectConfigStore()
    const brvConfig = await projectConfigStore.read()

    if (!brvConfig) {
      this.error('Project not initialized. Please run "brv init" first.', {exit: 1})
    }

    // Create dependencies for UseCases
    const terminal = new NoOpTerminal()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

    // Create UseCases
    const curateUseCase = new CurateUseCase({
      projectConfigStore,
      terminal,
      tokenStore,
      trackingService,
    })

    const queryUseCase = new QueryUseCase({
      projectConfigStore,
      terminal,
      tokenStore,
      trackingService,
    })

    // Create TaskProcessor with UseCases and auth
    const taskProcessor = createTaskProcessor({
      authToken: {
        accessToken: token.accessToken,
        sessionKey: token.sessionKey,
      },
      brvConfig,
      curateUseCase,
      logger,
      queryUseCase,
    })

    // Create CoreProcess with TaskProcessor
    const core = new CoreProcess({
      logger,
      preferredPort: flags.port,
      projectRoot: process.cwd(),
      taskProcessor,
    })

    try {
      await core.start()

      const state = core.getState()
      logger.info('Core process started', {port: state.port})
      logger.info('Instance file written', {path: '.brv/instance.json'})
      logger.info('TaskProcessor ready with UseCases')
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
