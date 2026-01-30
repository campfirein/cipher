import {Command, Flags} from '@oclif/core'

import {getCurrentConfig} from '../../server/config/environment.js'
import {IInitUseCase} from '../../server/core/interfaces/usecase/i-init-use-case.js'
import {HttpCogitPullService} from '../../server/infra/cogit/http-cogit-pull-service.js'
import {ProjectConfigStore} from '../../server/infra/config/file-config-store.js'
import {ConnectorManager} from '../../server/infra/connectors/connector-manager.js'
import {RuleTemplateService} from '../../server/infra/connectors/shared/template-service.js'
import {FileContextTreeService} from '../../server/infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../../server/infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeWriterService} from '../../server/infra/context-tree/file-context-tree-writer-service.js'
import {FsFileService} from '../../server/infra/file/fs-file-service.js'
import {HttpSpaceService} from '../../server/infra/space/http-space-service.js'
import {FileGlobalConfigStore} from '../../server/infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../server/infra/storage/token-store.js'
import {HttpTeamService} from '../../server/infra/team/http-team-service.js'
import {FsTemplateLoader} from '../../server/infra/template/fs-template-loader.js'
import {HeadlessTerminal} from '../../server/infra/terminal/headless-terminal.js'
import {OclifTerminal} from '../../server/infra/terminal/oclif-terminal.js'
import {MixpanelTrackingService} from '../../server/infra/tracking/mixpanel-tracking-service.js'
import {InitUseCase} from '../../server/infra/usecase/init-use-case.js'

/** Parsed flags type */
type InitFlags = {
  force?: boolean
  format?: 'json' | 'text'
  headless?: boolean
  space?: string
  team?: string
}

export default class Init extends Command {
  public static description = `Initialize a project with ByteRover

Sets up ByteRover for the current project by selecting a team and space.
For headless mode, you must provide --team and --space (ID or name).`
  public static examples = [
    '# Interactive initialization',
    '<%= config.bin %> <%= command.id %>',
    '',
    '# Force re-initialization',
    '<%= config.bin %> <%= command.id %> --force',
    '',
    '# Headless mode with team/space names',
    '<%= config.bin %> <%= command.id %> --headless --team my-team --space my-space --format json',
    '',
    '# Headless mode with team/space IDs',
    '<%= config.bin %> <%= command.id %> --headless --team team-abc123 --space space-xyz789 --format json',
  ]
  public static flags = {
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force re-initialization without confirmation prompt',
    }),
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    headless: Flags.boolean({
      default: false,
      description: 'Run in headless mode (no TTY required, requires --team and --space)',
    }),
    space: Flags.string({
      description: 'Space ID or name (required for headless mode)',
    }),
    team: Flags.string({
      description: 'Team ID or name (required for headless mode)',
    }),
  }

  protected createUseCase(options: {format: 'json' | 'text'; headless: boolean}): IInitUseCase {
    const envConfig = getCurrentConfig()
    const tokenStore = createTokenStore()
    const globalConfigStore = new FileGlobalConfigStore()
    const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})
    const contextTreeSnapshotService = new FileContextTreeSnapshotService()

    const fileService = new FsFileService()
    const templateLoader = new FsTemplateLoader(fileService)
    const templateService = new RuleTemplateService(templateLoader)

    // Use HeadlessTerminal for headless mode or JSON format
    const terminal =
      options.headless || options.format === 'json'
        ? new HeadlessTerminal({failOnPrompt: true, outputFormat: options.format})
        : new OclifTerminal(this)

    // Create ConnectorManager
    const connectorManager = new ConnectorManager({
      fileService,
      projectRoot: process.cwd(),
      templateService,
    })

    return new InitUseCase({
      cogitPullService: new HttpCogitPullService({
        apiBaseUrl: envConfig.cogitApiBaseUrl,
      }),
      connectorManager,
      contextTreeService: new FileContextTreeService(),
      contextTreeSnapshotService,
      contextTreeWriterService: new FileContextTreeWriterService({
        snapshotService: contextTreeSnapshotService,
      }),
      fileService,
      projectConfigStore: new ProjectConfigStore(),
      spaceService: new HttpSpaceService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      teamService: new HttpTeamService({
        apiBaseUrl: envConfig.apiBaseUrl,
      }),
      terminal,
      tokenStore,
      trackingService,
    })
  }

  public async run(): Promise<void> {
    const {flags: rawFlags} = await this.parse(Init)
    const flags = rawFlags as InitFlags
    const format = (flags.format ?? 'text') as 'json' | 'text'
    const headless = flags.headless ?? false

    // Validate headless mode requirements
    if (headless && (!flags.team || !flags.space)) {
      const terminal = new HeadlessTerminal({failOnPrompt: true, outputFormat: format})
      const response = {
        command: 'init',
        data: {
          error: 'Headless mode requires both --team and --space flags',
          status: 'error',
        },
        success: false,
        timestamp: new Date().toISOString(),
      }
      terminal.writeFinalResponse(response)
      return
    }

    await this.createUseCase({format, headless}).run({
      force: flags.force ?? false,
      format,
      spaceId: flags.space,
      teamId: flags.team,
    })
  }
}
