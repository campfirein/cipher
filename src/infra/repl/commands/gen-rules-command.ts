import {CommandKind, SlashCommand} from '../../../tui/types.js'
import {FsFileService} from '../../file/fs-file-service.js'
import {FileHookManager} from '../../hooks/file-hook-manager.js'
import {LegacyRuleDetector} from '../../rule/legacy-rule-detector.js'
import {RuleTemplateService} from '../../rule/rule-template-service.js'
import {FileGlobalConfigStore} from '../../storage/file-global-config-store.js'
import {createTokenStore} from '../../storage/token-store.js'
import {FsTemplateLoader} from '../../template/fs-template-loader.js'
import {ReplTerminal} from '../../terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../tracking/mixpanel-tracking-service.js'
import {GenerateRulesUseCase} from '../../usecase/generate-rules-use-case.js'

/**
 * Generate rules command
 *
 * Creates and runs GenerateRulesUseCase with ReplTerminal for TUI integration.
 */
export const genRulesCommand: SlashCommand = {
  action: () => ({
    async execute(onMessage, onPrompt) {
      // Create ReplTerminal with callbacks
      const terminal = new ReplTerminal({onMessage, onPrompt})

      // Create services
      const fileService = new FsFileService()
      const templateLoader = new FsTemplateLoader(fileService)
      const templateService = new RuleTemplateService(templateLoader)
      const globalConfigStore = new FileGlobalConfigStore()
      const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore: createTokenStore()})
      const hookManager = new FileHookManager(fileService)

      // Create and run UseCase
      const useCase = new GenerateRulesUseCase(
        fileService,
        new LegacyRuleDetector(),
        templateService,
        terminal,
        trackingService,
        hookManager,
      )

      await useCase.run()
    },
    type: 'streaming',
  }),
  aliases: [],
  autoExecute: true,
  description: 'Generate rule instructions for coding agents to work with ByteRover correctly',
  kind: CommandKind.BUILT_IN,
  name: 'gen-rules',
}
