import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Query command
 */
export const queryCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Query and retrieve information from the context tree',
  kind: CommandKind.BUILT_IN,
  name: 'query',
}
