import {randomUUID} from 'node:crypto'

import {isDevelopment} from '../../../server/config/environment.js'
import {FileGlobalConfigStore} from '../../../server/infra/storage/file-global-config-store.js'
import {createTokenStore} from '../../../server/infra/storage/token-store.js'
import {ReplTerminal} from '../../../server/infra/terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../../server/infra/tracking/mixpanel-tracking-service.js'
import {CurateUseCase} from '../../../server/infra/usecase/curate-use-case.js'
import {type CommandContext, CommandKind, type SlashCommand} from '../../../tui/types.js'
import {Flags, parseReplArgs, toCommandFlags} from './arg-parser.js'

// Dev-only flags - defined once, used for both parsing and help display
const devFlags = {
  apiKey: Flags.string({char: 'k', description: 'OpenRouter API key [Dev only]'}),
  model: Flags.string({char: 'm', description: 'Model to use [Dev only]'}),
  verbose: Flags.boolean({char: 'v', description: 'Enable verbose debug output [Dev only]'}),
}

/**
 * Curate command - Curate context to the context tree
 *
 * Supports both modes:
 * - Autonomous mode: /curate "your context" @file1 @file2
 * - Interactive mode: /curate (no args) - navigates context tree
 */
export const curateCommand: SlashCommand = {
  action(context: CommandContext, args: string) {
    return {
      async execute(onMessage, onPrompt) {
        // Files are pre-extracted by the command processor
        const files = context.invocation?.files ?? []

        // Parse flags and get context text
        let contextText: string | undefined
        let flags: {apiKey?: string; model?: string; verbose?: boolean} = {}

        if (isDevelopment()) {
          const parsed = await parseReplArgs(args, {flags: devFlags, strict: false})
          contextText = parsed.argv.join(' ') || undefined
          flags = parsed.flags
        } else {
          contextText = args || undefined
        }

        const terminal = new ReplTerminal({onMessage, onPrompt})
        const tokenStore = createTokenStore()
        const globalConfigStore = new FileGlobalConfigStore()

        const useCase = new CurateUseCase({
          terminal,
          trackingService: new MixpanelTrackingService({globalConfigStore, tokenStore}),
        })

        // Run the use case - mode determined by whether context is provided
        await useCase.run({
          context: contextText,
          files: files.length > 0 ? files : undefined,
          verbose: flags.verbose,
        })

        onMessage({
          content: 'View in Activity tab.             [tab]',
          id: randomUUID(),
          type: 'output',
        })
      },
      type: 'streaming' as const,
    }
  },
  aliases: [],
  args: [
    {
      description: 'Knowledge context (optional, triggers autonomous mode)',
      name: 'context',
      required: false,
    },
  ],
  autoExecute: true,
  description: 'Curate context to the context tree.',
  flags: [
    {
      char: '@',
      description: 'Include files (type @ to browse, max 5)',
      name: 'file',
      type: 'file',
    },
    ...(isDevelopment() ? toCommandFlags(devFlags) : []),
  ],
  kind: CommandKind.BUILT_IN,
  name: 'curate',
}
