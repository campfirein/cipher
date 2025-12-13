import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Initialize command
 */
export const initCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Initialize a project with ByteRover',
  flags: [
    {
      char: 'f',
      default: false,
      description: 'Force re-initialization without confirmation prompt',
      name: 'force',
      type: 'boolean',
    },
  ],
  kind: CommandKind.BUILT_IN,
  name: 'init',
}
