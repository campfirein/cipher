import {type CommandContext, CommandKind, type SlashCommand} from '../../../tui/types.js'
import {ProjectConfigStore} from '../../config/file-config-store.js'
import {FileContextTreeService} from '../../context-tree/file-context-tree-service.js'
import {FileContextTreeSnapshotService} from '../../context-tree/file-context-tree-snapshot-service.js'
import {FileGlobalConfigStore} from "../../storage/file-global-config-store.js";
import {createTokenStore} from '../../storage/token-store.js'
import {ReplTerminal} from '../../terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../tracking/mixpanel-tracking-service.js'
import {StatusUseCase} from '../../usecase/status-use-case.js'

/**
 * Status command
 */
export const statusCommand: SlashCommand = {
  action(context: CommandContext, _args: string) {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})
        const tokenStore = createTokenStore()
        const globalConfigStore = new FileGlobalConfigStore()
        const trackingService = new MixpanelTrackingService({globalConfigStore, tokenStore})

        const useCase = new StatusUseCase({
          contextTreeService: new FileContextTreeService(),
          contextTreeSnapshotService: new FileContextTreeSnapshotService(),
          projectConfigStore: new ProjectConfigStore(),
          terminal,
          tokenStore,
          trackingService,
        })

        await useCase.run({cliVersion: context.version ?? ''})
      },
      type: 'streaming',
    }
  },
  aliases: [],
  autoExecute: true,
  description: 'Show CLI status and project information',
  kind: CommandKind.BUILT_IN,
  name: 'status',
}
