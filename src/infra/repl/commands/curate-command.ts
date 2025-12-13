import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Curate command
 */
export const curateCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Curate context to the context tree',
  kind: CommandKind.BUILT_IN,
  name: 'curate',
}
