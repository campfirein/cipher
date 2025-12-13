import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Status command
 */
export const statusCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Show CLI status and project information. Display local context tree managed by ByteRover CLI',
  kind: CommandKind.BUILT_IN,
  name: 'status',
}
