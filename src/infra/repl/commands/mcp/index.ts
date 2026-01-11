import { CommandKind, type SlashCommand } from '../../../../tui/types.js'
import { setupCommand } from './setup-command.js'
import { statusCommand } from './status-command.js'

/**
 * MCP command - manages MCP server for coding agent integration
 */
export const mcpCommand: SlashCommand = {
  aliases: [],
  autoExecute: true,
  description: 'MCP server setup for coding agent integration',
  kind: CommandKind.BUILT_IN,
  name: 'mcp',
  subCommands: [setupCommand, statusCommand],
}
