import { CommandKind, type SlashCommand } from '../../../../tui/types.js'
import { ReplTerminal } from '../../../terminal/repl-terminal.js'

const mcpConfig = {
  mcpServers: {
    'byterover-cli': {
      args: ['mcp'],
      command: 'brv',
    },
  },
}

/**
 * MCP setup command - shows configuration instructions for coding agents
 */
export const setupCommand: SlashCommand = {
  action() {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({ onMessage, onPrompt })

        terminal.log('')
        terminal.log('MCP Server Configuration')
        terminal.log('========================')
        terminal.log('')
        terminal.log('Add the following configuration to your coding agent:')
        terminal.log('')
        terminal.log('Claude Code (~/.claude.json):')
        terminal.log(JSON.stringify(mcpConfig, null, 2))
        terminal.log('')
        terminal.log('Cursor (.cursor/mcp.json):')
        terminal.log(JSON.stringify(mcpConfig, null, 2))
        terminal.log('')
        terminal.log('Note: Keep this brv instance running for MCP to work.')
        terminal.log('')
      },
      type: 'streaming',
    }
  },
  aliases: [],
  autoExecute: true,
  description: 'Show MCP configuration instructions for coding agents',
  kind: CommandKind.BUILT_IN,
  name: 'setup',
}
