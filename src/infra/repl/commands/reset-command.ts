import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Reset command
 */
export const resetCommand: SlashCommand = {
  aliases: [],
  args: [
    {
      description: 'Project directory (defaults to current directory)',
      name: 'directory',
      required: false,
    },
  ],
  autoExecute: true,
  description: 'Reset the current context tree and start with 6 default domains',
  flags: [
    {
      char: 'y',
      default: false,
      description: 'Skip confirmation prompt',
      name: 'yes',
      type: 'boolean',
    },
  ],
  kind: CommandKind.BUILT_IN,
  name: 'reset',
}
