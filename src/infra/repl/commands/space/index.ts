import {CommandKind, SlashCommand} from '../../../../tui/types.js'
import {listCommand} from './list-command.js'
import {switchCommand} from './switch-command.js'

/**
 * Space command - manages ByteRover spaces
 */
export const spaceCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Manage ByteRover spaces - /space <list|switch>',
  kind: CommandKind.BUILT_IN,
  name: 'space',
  subCommands: [listCommand, switchCommand],
}
