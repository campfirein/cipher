import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Pull command
 */
export const pullCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Pull context tree from ByteRover memory storage',
  flags: [
    {
      char: 'b',
      default: 'main',
      description: 'ByteRover branch name (not Git branch)',
      name: 'branch',
      type: 'string',
    },
  ],
  kind: CommandKind.BUILT_IN,
  name: 'pull',
}
