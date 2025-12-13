import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Initialize command
 */
export const initCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Initialize a project with ByteRover',
  kind: CommandKind.BUILT_IN,
  name: 'init',
}
