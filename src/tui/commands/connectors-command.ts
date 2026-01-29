import {ConnectorManager} from '../../server/infra/connectors/connector-manager.js'
import {RuleTemplateService} from '../../server/infra/connectors/shared/template-service.js'
import {FsFileService} from '../../server/infra/file/fs-file-service.js'
import {FileGlobalConfigStore} from '../../server/infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../server/infra/storage/token-store.js'
import {FsTemplateLoader} from '../../server/infra/template/fs-template-loader.js'
import {ReplTerminal} from '../../server/infra/terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../server/infra/tracking/mixpanel-tracking-service.js'
import {ConnectorsUseCase} from '../../server/infra/usecase/connectors-use-case.js'
import {CommandKind, SlashCommand} from '../types.js'

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
