import {CommandKind, SlashCommand} from '../../../tui/types.js'
import {ConnectorManager} from '../../connectors/connector-manager.js'
import {RuleTemplateService} from '../../connectors/shared/template-service.js'
import {FsFileService} from '../../file/fs-file-service.js'
import {FileGlobalConfigStore} from '../../storage/file-global-config-store.js'
import {createTokenStore} from '../../storage/token-store.js'
import {FsTemplateLoader} from '../../template/fs-template-loader.js'
import {ReplTerminal} from '../../terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../tracking/mixpanel-tracking-service.js'
import {ConnectorsUseCase} from '../../usecase/connectors-use-case.js'

/**
 * Connectors command
 *
 * Manages connectors (rules, hook) for integrating BRV with coding agents.
 * Lists connected agents and allows managing or adding new connections.
 */
export const connectorsCommand: SlashCommand = {
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

      // Create ConnectorManager
      const connectorManager = new ConnectorManager({
        fileService,
        projectRoot: process.cwd(),
        templateService,
      })

      // Create and run UseCase
      const useCase = new ConnectorsUseCase({
        connectorManager,
        terminal,
        trackingService,
      })

      await useCase.run()
    },
    type: 'streaming',
  }),
  aliases: [],
  autoExecute: true,
  description: 'Manage agent connectors (rules, hook, mcp, or skill)',
  kind: CommandKind.BUILT_IN,
  name: 'connectors',
}
