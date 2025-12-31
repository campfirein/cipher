import {Args, Command, Flags} from '@oclif/core'

import type {IStatusUseCase} from '../core/interfaces/usecase/i-status-use-case.js'

import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {FileContextTreeService} from '../infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../infra/context-tree/file-context-tree-snapshot-service.js'
import {FileGlobalConfigStore} from '../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../infra/storage/token-store.js'
import {OclifTerminal} from '../infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {StatusUseCase} from '../infra/usecase/status-use-case.js'

export default class Status extends Command {
  public static args = {
    directory: Args.string({description: 'Project directory (defaults to current directory)', required: false}),
  }
  public static description =
    'Show CLI status and project information. Display local context tree managed by ByteRover CLI'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '# Check status after login:\n<%= config.bin %> login\n<%= config.bin %> <%= command.id %>',
    '# Verify project initialization:\n<%= config.bin %> init\n<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> /path/to/project',
    '<%= config.bin %> <%= command.id %> --format json',
  ]
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'table',
      description: 'Output format',
      options: ['table', 'json'],
    }),
  }

  protected createUseCase(): IStatusUseCase {
    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
    const contextTreeSnapshotService = new FileContextTreeSnapshotService()

    return new StatusUseCase({
      contextTreeService: new FileContextTreeService(),
      contextTreeSnapshotService,
      projectConfigStore: new ProjectConfigStore(),
      terminal: new OclifTerminal(this),
      tokenStore,
      trackingService,
    })
  }

  public async run(): Promise<void> {
    await this.createUseCase().run({cliVersion: this.config.version})
  }
}
