import {FileGlobalConfigStore} from '../../server/infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../server/infra/storage/token-store.js'
import {ReplTerminal} from '../../server/infra/terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../server/infra/tracking/mixpanel-tracking-service.js'
import {LogoutUseCase} from '../../server/infra/usecase/logout-use-case.js'
import {CommandContext, CommandKind, SlashCommand} from '../types.js'
import {Flags, parseReplArgs, toCommandFlags} from './arg-parser.js'

// Flags - defined once, used for both parsing and help display
const logoutFlags = {
  yes: Flags.boolean({
    char: 'y',
    default: false,
    description: 'Skip confirmation prompt',
  }),
}

/**
 * Logout command
 */
export const logoutCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})

        const parsed = await parseReplArgs(args, {
          flags: logoutFlags,
          strict: false,
        })

        const tokenStore = createTokenStore()
        const globalConfigStore = new FileGlobalConfigStore()
        const useCase = new LogoutUseCase({
          terminal,
          tokenStore,
          trackingService: new MixpanelTrackingService({globalConfigStore, tokenStore}),
        })

        await useCase.run({skipConfirmation: parsed.flags.yes ?? false})
      },
      type: 'streaming',
    }
  },
  aliases: [],
  autoExecute: true,
  description: 'Log out of ByteRover CLI and clear authentication',
  flags: toCommandFlags(logoutFlags),
  kind: CommandKind.BUILT_IN,
  name: 'logout',
}
