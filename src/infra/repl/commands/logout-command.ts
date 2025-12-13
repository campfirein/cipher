import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Logout command
 */
export const logoutCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Log out of ByteRover CLI and clear authentication',
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
  name: 'logout',
}
