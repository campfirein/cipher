import {CommandKind, SlashCommand} from '../../../tui/types.js'

/**
 * Generate rules command
 */
export const genRulesCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'Generate rule instructions for coding agents to work with ByteRover correctly',
  kind: CommandKind.BUILT_IN,
  name: 'gen-rules',
}
