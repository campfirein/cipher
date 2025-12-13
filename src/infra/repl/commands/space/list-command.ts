import {CommandKind, SlashCommand} from '../../../../tui/types.js'

/**
 * List spaces command
 */
export const listCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'List all spaces for the current team',
  flags: [
    {
      char: 'a',
      default: false,
      description: 'Fetch all spaces (may be slow for large teams)',
      name: 'all',
      type: 'boolean',
    },
    {
      char: 'j',
      default: false,
      description: 'Output in JSON format',
      name: 'json',
      type: 'boolean',
    },
    {
      char: 'l',
      default: '50',
      description: 'Maximum number of spaces to fetch',
      name: 'limit',
      type: 'string',
    },
    {
      char: 'o',
      default: '0',
      description: 'Number of spaces to skip',
      name: 'offset',
      type: 'string',
    },
  ],
  kind: CommandKind.BUILT_IN,
  name: 'list',
}
