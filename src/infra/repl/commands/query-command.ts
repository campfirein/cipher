import {isDevelopment} from '../../../config/environment.js'
import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Query command
 */
export const queryCommand: SlashCommand = {
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
