import {Command, Flags} from '@oclif/core'

import type {IPushUseCase} from '../core/interfaces/usecase/i-push-use-case.js'

import {getCurrentConfig} from '../config/environment.js'
import {DEFAULT_BRANCH} from '../constants.js'
import {ExitError} from '../infra/cipher/exit-codes.js'
import {HttpCogitPushService} from '../infra/cogit/http-cogit-push-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileContextFileReader} from '../infra/context-tree/file-context-file-reader.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {PushUseCase} from '../infra/usecase/push-use-case.js'

export default class Push extends Command {
  public static description = 'Push context tree to ByteRover memory storage'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --branch develop',
    '<%= config.bin %> <%= command.id %> -b feature-auth',
  ]
  public static flags = {
    branch: Flags.string({
      // Can pass either --branch or -b
      char: 'b',
      default: DEFAULT_BRANCH,
      description: 'ByteRover branch name (not Git branch)',
    }),
    yes: Flags.boolean({
      char: 'y',
      default: false,
      description: 'Skip confirmation prompt',
    }),
  }

  // Override catch to prevent oclif from logging errors that were already displayed
  async catch(error: Error & {oclif?: {exit: number}}): Promise<void> {
    // Check if error is ExitError (message already displayed by exitWithCode)
    if (error instanceof ExitError) {
      return
    }

    // Backwards compatibility: also check oclif.exit property
    if (error.oclif?.exit !== undefined) {
      // Error already displayed by exitWithCode, silently exit
      return
    }

    // For other errors, re-throw to let oclif handle them
    throw error
  }

  protected createUseCase(): IPushUseCase {
    const envConfig = getCurrentConfig()
    const tokenStore = new KeychainTokenStore()
    const trackingService = new MixpanelTrackingService(tokenStore)

    return new PushUseCase({
      cogitPushService: new HttpCogitPushService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      contextFileReader: new FileContextFileReader(),
      contextTreeSnapshotService: new FileContextTreeSnapshotService(),
      projectConfigStore: new ProjectConfigStore(),
      terminal: new OclifTerminal(this),
      tokenStore,
      trackingService,
      webAppUrl: envConfig.webAppUrl,
    })
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(Push)
    await this.createUseCase().run({ branch: flags.branch, skipConfirmation: flags.yes })
  }
}
