import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Reset command
 */
export const resetCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Reset the current context tree and start with 6 default domains',
  kind: CommandKind.BUILT_IN,
  name: 'reset',
}
