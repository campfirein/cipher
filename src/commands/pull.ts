import {Command, Flags} from '@oclif/core'

import type {IPullUseCase} from '../core/interfaces/usecase/i-pull-use-case.js'

import {getCurrentConfig} from '../config/environment.js'
import {DEFAULT_BRANCH} from '../constants.js'
import {HttpCogitPullService} from '../infra/cogit/http-cogit-pull-service.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeWriterService} from '../infra/context-tree/file-context-tree-writer-service.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {PullUseCase} from '../infra/usecase/pull-use-case.js'

export default class Pull extends Command {
  public static description = 'Pull context tree from ByteRover memory storage'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --branch develop',
    '<%= config.bin %> <%= command.id %> -b feature-auth',
  ]
  public static flags = {
    branch: Flags.string({
      char: 'b',
      default: DEFAULT_BRANCH,
      description: 'ByteRover branch name (not Git branch)',
    }),
  }

  protected createUseCase(): IPullUseCase {
    const tokenStore = new KeychainTokenStore()
    const contextTreeSnapshotService = new FileContextTreeSnapshotService()
    const envConfig = getCurrentConfig()

    return new PullUseCase({
      cogitPullService: new HttpCogitPullService({apiBaseUrl: envConfig.cogitApiBaseUrl}),
      contextTreeSnapshotService,
      contextTreeWriterService: new FileContextTreeWriterService({snapshotService: contextTreeSnapshotService}),
      projectConfigStore: new ProjectConfigStore(),
      terminal: new OclifTerminal(this),
      tokenStore,
      trackingService: new MixpanelTrackingService(tokenStore),
    })
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Pull)
    await this.createUseCase().run({branch: flags.branch})
  }
}
