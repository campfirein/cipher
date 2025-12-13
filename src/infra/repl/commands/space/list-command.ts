import {CommandKind, SlashCommand} from '../../../../tui/types.js'

/**
 * List spaces command
 */
export const listCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'List all spaces for the current team',
  kind: CommandKind.BUILT_IN,
  name: 'list',
}
