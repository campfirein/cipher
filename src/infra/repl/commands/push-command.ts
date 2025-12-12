import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Push command
 */
export const pushCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Push context tree to ByteRover memory storage',
  kind: CommandKind.BUILT_IN,
  name: 'push',
}
