import {getCurrentConfig} from '../../config/environment.js'
import {HttpCogitPullService} from '../../infra/cogit/http-cogit-pull-service.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {ConnectorManager} from '../../infra/connectors/connector-manager.js'
import {RuleTemplateService} from '../../infra/connectors/shared/template-service.js'
import {FileContextTreeService} from '../../infra/context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../../infra/context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeWriterService} from '../../infra/context-tree/file-context-tree-writer-service.js'
import {FsFileService} from '../../infra/file/fs-file-service.js'
import {HttpSpaceService} from '../../infra/space/http-space-service.js'
import {FileGlobalConfigStore} from '../../infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../infra/storage/token-store.js'
import {HttpTeamService} from '../../infra/team/http-team-service.js'
import {FsTemplateLoader} from '../../infra/template/fs-template-loader.js'
import {ReplTerminal} from '../../infra/terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../infra/tracking/mixpanel-tracking-service.js'
import {InitUseCase} from '../../infra/usecase/init-use-case.js'
import {CommandKind, SlashCommand} from '../types.js'
import {Flags, parseReplArgs, toCommandFlags} from './arg-parser.js'

// Flags - defined once, used for both parsing and help display
const initFlags = {
  force: Flags.boolean({char: 'f', description: 'Force re-initialization without confirmation prompt'}),
}

/**
 * Initialize command
 *
 * Creates and runs InitUseCase with ReplTerminal for TUI integration.
 */
export const initCommand: SlashCommand = {
  action(_context, args) {
    return {
      async execute(onMessage, onPrompt) {
        // Parse flags
        const parsed = await parseReplArgs(args, {flags: initFlags})
        const force = parsed.flags.force ?? false

        // Create ReplTerminal with callbacks
        const terminal = new ReplTerminal({onMessage, onPrompt})

        // Create services
        const envConfig = getCurrentConfig()
        const tokenStore = createTokenStore()
        const globalConfigStore = new FileGlobalConfigStore()
        const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

        const fileService = new FsFileService()
        const templateLoader = new FsTemplateLoader(fileService)
        const templateService = new RuleTemplateService(templateLoader)
        const contextTreeSnapshotService = new FileContextTreeSnapshotService()

        // Create ConnectorManager
        const connectorManager = new ConnectorManager({
          fileService,
          projectRoot: process.cwd(),
          templateService,
        })

        // Create and run use case
        const useCase = new InitUseCase({
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

        await useCase.run({force})
      },
      type: 'streaming' as const,
    }
  },
  aliases: [],
  autoExecute: true,
  description: 'Initialize a project with ByteRover',
  flags: toCommandFlags(initFlags),
  kind: CommandKind.BUILT_IN,
  name: 'init',
}
