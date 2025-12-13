import {isDevelopment} from '../../../config/environment.js'
import {type CommandContext, CommandKind, type SlashCommand} from '../../../tui/types.js'
import {ProjectConfigStore} from '../../config/file-config-store.js'
import {KeychainTokenStore} from '../../storage/keychain-token-store.js'
import {ReplTerminal} from '../../terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../tracking/mixpanel-tracking-service.js'
import {QueryUseCase} from '../../usecase/query-use-case.js'

/**
 * Parse flags from args string
 * Returns { flags: Record<string, string | boolean>, remaining: string }
 */
function parseArgs(
  args: string,
  flagDefs: Array<{char?: string; name: string; type: 'boolean' | 'string'}>,
): {flags: Record<string, boolean | string>; remaining: string} {
  const flags: Record<string, boolean | string> = {}
  let remaining = args

  for (const def of flagDefs) {
    if (def.type === 'string') {
      // Match --name=value or --name value
      const longPattern = new RegExp(`--${def.name}(?:=|\\s+)([^\\s]+)`, 'i')
      const longMatch = remaining.match(longPattern)
      if (longMatch) {
        flags[def.name] = longMatch[1]
        remaining = remaining.replace(longMatch[0], '').trim()
        continue
      }

      // Match -c value (short flag)
      if (def.char) {
        const shortPattern = new RegExp(`-${def.char}\\s+([^\\s]+)`, 'i')
        const shortMatch = remaining.match(shortPattern)
        if (shortMatch) {
          flags[def.name] = shortMatch[1]
          remaining = remaining.replace(shortMatch[0], '').trim()
        }
      }
    } else if (def.type === 'boolean') {
      // Match --name or -c for boolean flags
      if (remaining.includes(`--${def.name}`)) {
        flags[def.name] = true
        remaining = remaining.replace(`--${def.name}`, '').trim()
      } else if (def.char && remaining.includes(`-${def.char}`)) {
        flags[def.name] = true
        remaining = remaining.replace(new RegExp(`-${def.char}(?=\\s|$)`), '').trim()
      }
    }
  }

  // Clean up multiple spaces
  remaining = remaining.replaceAll(/\s+/g, ' ').trim()

  return {flags, remaining}
}

/**
 * Query command - Query and retrieve information from the context tree
 */
export const queryCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    // Parse flags if in development mode
    const flagDefs = isDevelopment()
      ? [
          {char: 'k', name: 'apiKey', type: 'string' as const},
          {char: 'm', name: 'model', type: 'string' as const},
          {char: 'v', name: 'verbose', type: 'boolean' as const},
        ]
      : []

    const {flags, remaining: query} = parseArgs(args, flagDefs)

    if (!query) {
      return {
        content: 'Please provide a query. Usage: /query <your question>',
        messageType: 'error' as const,
        type: 'message' as const,
      }
    }

    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})

        // Create services
        const tokenStore = new KeychainTokenStore()
        const useCase = new QueryUseCase({
          projectConfigStore: new ProjectConfigStore(),
          terminal,
          tokenStore,
          trackingService: new MixpanelTrackingService(tokenStore),
        })

        // Run the use case with parsed options
        await useCase.run({
          apiKey: flags.apiKey as string | undefined,
          model: flags.model as string | undefined,
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
  flags: isDevelopment()
    ? [
        {
          char: 'k',
          description: 'OpenRouter API key [Dev only]',
          name: 'apiKey',
          type: 'string',
        },
        {
          char: 'm',
          description: 'Model to use [Dev only]',
          name: 'model',
          type: 'string',
        },
        {
          char: 'v',
          default: false,
          description: 'Enable verbose debug output [Dev only]',
          name: 'verbose',
          type: 'boolean',
        },
      ]
    : [],
  kind: CommandKind.BUILT_IN,
  name: 'query',
}
