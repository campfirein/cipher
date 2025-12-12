import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Clear command - clears the message history
 */
export const clearCommand: SlashCommand = {
  action: () => ({
    type: 'clear',
  }),
  aliases: ['cls'],
  autoExecute: true,
  description: 'Clear the screen',
  kind: CommandKind.BUILT_IN,
  name: 'clear',
}
