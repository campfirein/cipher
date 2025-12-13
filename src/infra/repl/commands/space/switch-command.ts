import {CommandKind, SlashCommand} from '../../../../tui/types.js'

/**
 * Switch space command
 */
export const switchCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Switch to a different space',
  kind: CommandKind.BUILT_IN,
  name: 'switch',
}
