import {getCurrentConfig} from '../../../config/environment.js'
import {CommandKind, SlashCommand} from '../../../tui/types.js'
import {HttpCogitPullService} from '../../cogit/http-cogit-pull-service.js'
import {ProjectConfigStore} from '../../config/file-config-store.js'
import {FileContextTreeService} from '../../context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../../context-tree/file-context-tree-snapshot-service.js'
import {FileContextTreeWriterService} from '../../context-tree/file-context-tree-writer-service.js'
import {FsFileService} from '../../file/fs-file-service.js'
import {FileHookManager} from '../../hooks/file-hook-manager.js'
import {LegacyRuleDetector} from '../../rule/legacy-rule-detector.js'
import {RuleTemplateService} from '../../rule/rule-template-service.js'
import {HttpSpaceService} from '../../space/http-space-service.js'
import {FileGlobalConfigStore} from "../../storage/file-global-config-store.js";
import {createTokenStore} from '../../storage/token-store.js'
import {HttpTeamService} from '../../team/http-team-service.js'
import {FsTemplateLoader} from '../../template/fs-template-loader.js'
import {ReplTerminal} from '../../terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../tracking/mixpanel-tracking-service.js'
import {InitUseCase} from '../../usecase/init-use-case.js'
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
        const ruleTemplateService = new RuleTemplateService(templateLoader)

        const legacyRuleDetector = new LegacyRuleDetector()
        const contextTreeSnapshotService = new FileContextTreeSnapshotService()

        // Create and run use case
        const useCase = new InitUseCase({
          cogitPullService: new HttpCogitPullService({
            apiBaseUrl: envConfig.cogitApiBaseUrl,
          }),
          contextTreeService: new FileContextTreeService(),
          contextTreeSnapshotService,
          contextTreeWriterService: new FileContextTreeWriterService({
            snapshotService: contextTreeSnapshotService,
          }),
          fileService,
          hookManager: new FileHookManager(fileService),
          legacyRuleDetector,
          projectConfigStore: new ProjectConfigStore(),
          spaceService: new HttpSpaceService({
            apiBaseUrl: envConfig.apiBaseUrl,
          }),
          teamService: new HttpTeamService({
            apiBaseUrl: envConfig.apiBaseUrl,
          }),
          templateService: ruleTemplateService,
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
