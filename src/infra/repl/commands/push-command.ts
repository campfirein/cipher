import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Push command
 */
export const pushCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Push context tree to ByteRover memory storage',
  flags: [
    {
      char: 'b',
      default: 'main',
      description: 'ByteRover branch name (not Git branch)',
      name: 'branch',
      type: 'string',
    },
    {
      char: 'y',
      default: false,
      description: 'Skip confirmation prompt',
      name: 'yes',
      type: 'boolean',
    },
  ],
  kind: CommandKind.BUILT_IN,
  name: 'push',
}
