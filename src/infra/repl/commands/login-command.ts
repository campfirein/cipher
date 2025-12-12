import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Login command
 */
export const loginCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Authenticate with ByteRover using OAuth 2.0 + PKCE',
  kind: CommandKind.BUILT_IN,
  name: 'login',
}
