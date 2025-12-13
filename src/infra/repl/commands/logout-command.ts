import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Logout command
 */
export const logoutCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Log out of ByteRover CLI and clear authentication',
  kind: CommandKind.BUILT_IN,
  name: 'logout',
}
