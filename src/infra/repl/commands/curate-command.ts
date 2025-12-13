import {isDevelopment} from '../../../config/environment.js'
import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Curate command
 */
export const curateCommand: SlashCommand = {
  aliases: [],
  args: [
    {
      description: 'Knowledge context (triggers autonomous mode)',
      name: 'context',
      required: false,
    },
  ],
  autoExecute: false,
  description: 'Curate context to the context tree',
  flags: [
    {
      char: 'f',
      description: 'Include specific file paths for context (max 5 files)',
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
