import {randomUUID} from 'node:crypto'

import {isDevelopment} from '../../../config/environment.js'
import {type CommandContext, CommandKind, type SlashCommand} from '../../../tui/types.js'
import {ProjectConfigStore} from '../../config/file-config-store.js'
import {KeychainTokenStore} from '../../storage/keychain-token-store.js'
import {ReplTerminal} from '../../terminal/repl-terminal.js'
import {MixpanelTrackingService} from '../../tracking/mixpanel-tracking-service.js'
import {CurateUseCase} from '../../usecase/curate-use-case.js'

/**
 * Parsed curate command arguments
 */
interface ParsedCurateArgs {
  apiKey?: string
  context?: string
  files?: string[]
  model?: string
  verbose?: boolean
}

/**
 * Parse curate command arguments.
 * Handles quoted context strings, multiple @file references, and flags.
 *
 * Examples:
 *   "JWT auth uses cookies" @src/auth.ts
 *   my context here @a.ts @b.ts --verbose
 */
function parseCurateArgs(args: string): ParsedCurateArgs {
  const result: ParsedCurateArgs = {}
  let remaining = args.trim()

  // Extract all @file references
  const files: string[] = []
  remaining = remaining.replaceAll(/@([^\s@]+)/g, (_, filePath: string) => {
    files.push(filePath)
    return ''
  })

  // Also support -f/--files flags for backwards compatibility
  // Match --files=value or --files value
  remaining = remaining.replaceAll(/--files(?:=|\s+)([^\s]+)/gi, (_, value: string) => {
    files.push(value)
    return ''
  })
  // Match -f value
  remaining = remaining.replaceAll(/-f\s+([^\s]+)/gi, (_, value: string) => {
    files.push(value)
    return ''
  })

  if (files.length > 0) {
    result.files = files
  }

  // Extract dev-only flags (only in development mode)
  if (isDevelopment()) {
    // --apiKey=value or --apiKey value or -k value
    const apiKeyMatch = remaining.match(/(?:--apiKey(?:=|\s+)|(-k)\s+)([^\s]+)/i)
    if (apiKeyMatch) {
      result.apiKey = apiKeyMatch[2]
      remaining = remaining.replace(apiKeyMatch[0], '')
    }

    // --model=value or --model value or -m value
    const modelMatch = remaining.match(/(?:--model(?:=|\s+)|(-m)\s+)([^\s]+)/i)
    if (modelMatch) {
      result.model = modelMatch[2]
      remaining = remaining.replace(modelMatch[0], '')
    }

    // --verbose or -v
    if (/--verbose(?:\s|$)/.test(remaining) || /(?:^|\s)-v(?:\s|$)/.test(remaining)) {
      result.verbose = true
      remaining = remaining.replace(/--verbose/, '').replace(/(?:^|\s)-v(?=\s|$)/, '')
    }
  }

  // Clean up multiple spaces
  remaining = remaining.replaceAll(/\s+/g, ' ').trim()

  // Extract context (may be quoted or unquoted)
  if (remaining) {
    // Check for quoted string at the start
    const quotedMatch = remaining.match(/^"([^"]*)"/)
    result.context = quotedMatch ? quotedMatch[1] : remaining
  }

  return result
}

/**
 * Curate command - Curate context to the context tree
 *
 * Supports both modes:
 * - Autonomous mode: /curate "your context" [-f file1] [-f file2]
 * - Interactive mode: /curate (no args) - navigates context tree
 */
export const curateCommand: SlashCommand = {
  action(_context: CommandContext, args: string) {
    const parsed = parseCurateArgs(args)

    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({onMessage, onPrompt})

        // Create services
        const tokenStore = new KeychainTokenStore()
        const useCase = new CurateUseCase({
          projectConfigStore: new ProjectConfigStore(),
          terminal,
          tokenStore,
          trackingService: new MixpanelTrackingService(tokenStore),
        })

        // Run the use case - mode determined by whether context is provided
        // context provided = autonomous mode, no context = interactive mode
        await useCase.run({
          apiKey: parsed.apiKey,
          context: parsed.context,
          files: parsed.files,
          model: parsed.model,
          verbose: parsed.verbose,
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
      name: 'files',
      type: 'string',
    },
    ...(isDevelopment()
      ? [
          {
            char: 'k',
            description: 'OpenRouter API key [Dev only]',
            name: 'apiKey',
            type: 'string' as const,
          },
          {
            char: 'm',
            description: 'Model to use [Dev only]',
            name: 'model',
            type: 'string' as const,
          },
          {
            char: 'v',
            default: false,
            description: 'Enable verbose debug output [Dev only]',
            name: 'verbose',
            type: 'boolean' as const,
          },
        ]
      : []),
  ],
  kind: CommandKind.BUILT_IN,
  name: 'curate',
}
