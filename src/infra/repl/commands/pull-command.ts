import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Pull command
 */
export const pullCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Pull context tree from ByteRover memory storage',
  kind: CommandKind.BUILT_IN,
  name: 'pull',
}
