import {isDevelopment} from '../../../config/environment.js'
import {type CommandContext, CommandKind, type SlashCommand} from '../../../tui/types.js'
import {FileGlobalConfigStore} from "../../storage/file-global-config-store.js";
import {createTokenStore} from '../../storage/token-store.js'
import {ReplTerminal} from '../../terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../tracking/mixpanel-tracking-service.js'
import {QueryUseCase} from '../../usecase/query-use-case.js'
import {Flags, parseReplArgs, toCommandFlags} from './arg-parser.js'

// Dev-only flags - defined once, used for both parsing and help display
const devFlags = {
  apiKey: Flags.string({char: 'k', description: 'OpenRouter API key [Dev only]'}),
  model: Flags.string({char: 'm', description: 'Model to use [Dev only]'}),
  verbose: Flags.boolean({char: 'v', description: 'Enable verbose debug output [Dev only]'}),
}

/**
 * Query command - Query and retrieve information from the context tree
 */
export const queryCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        // Parse flags only in dev mode, otherwise use args directly as query
        let query: string
        let flags: {apiKey?: string; model?: string; verbose?: boolean} = {}

        if (isDevelopment()) {
          const parsed = await parseReplArgs(args, {flags: devFlags, strict: false})
          query = parsed.argv.join(' ')
          flags = parsed.flags
        } else {
          query = args
        }

        const terminal = new ReplTerminal({onMessage, onPrompt})
        const tokenStore = createTokenStore()
        const globalConfigStore = new FileGlobalConfigStore()

        const useCase = new QueryUseCase({
          terminal,
          trackingService: new MixpanelTrackingService({globalConfigStore, tokenStore}),
        })

        await useCase.run({
          apiKey: flags.apiKey,
          model: flags.model,
          query,
          verbose: Boolean(flags.verbose),
        })
      },
      type: 'streaming' as const,
    }
  },
  aliases: ['q'],
  args: [
    {
      description: 'Natural language question about your codebase',
      name: 'query',
      required: true,
    },
  ],
  autoExecute: false,
  description: 'Query and retrieve information from the context tree',
  flags: isDevelopment() ? toCommandFlags(devFlags) : [],
  kind: CommandKind.BUILT_IN,
  name: 'query',
}
