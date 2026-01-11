import { CommandKind, type SlashCommand } from '../../../../tui/types.js'
import { ProjectConfigStore } from '../../../config/file-config-store.js'
import { createTokenStore } from '../../../storage/token-store.js'
import { ReplTerminal } from '../../../terminal/repl-terminal.js'

/**
 * MCP status command - shows MCP readiness status
 */
export const statusCommand: SlashCommand = {
  action() {
    return {
      async execute(onMessage, onPrompt) {
        const terminal = new ReplTerminal({ onMessage, onPrompt })
        const tokenStore = createTokenStore()
        const configStore = new ProjectConfigStore()

        terminal.log('')
        terminal.log('MCP Status')
        terminal.log('==========')

        // Check authentication
        const authToken = await tokenStore.load()
        if (authToken && !authToken.isExpired()) {
          terminal.log(`Authentication: Logged in as ${authToken.userEmail}`)
        } else {
          terminal.log('Authentication: Not logged in')
          terminal.log('  Run /login to authenticate')
        }

        // Check project config
        const config = await configStore.read()
        if (config) {
          terminal.log(`Project: Initialized`)
          if (config.spaceName) {
            terminal.log(`Space: ${config.spaceName}`)
          }
        } else {
          terminal.log('Project: Not initialized')
          terminal.log('  Run /init to set up the project')
        }

        terminal.log('')

        // Show readiness
        const isReady = authToken && !authToken.isExpired()
        if (isReady) {
          terminal.log('Instance: Running (ready for MCP connections)')
        } else {
          terminal.log('Instance: Running (but authentication required)')
        }

        terminal.log('')
        terminal.log('Available tools:')
        terminal.log('- brv-query: Query the context tree')
        terminal.log('- brv-curate: Curate context to the tree')
        terminal.log('')
        terminal.log('MCP Configuration:')
        terminal.log('Add to your coding agent config:')
        terminal.log('')
        terminal.log(JSON.stringify({
          mcpServers: {
            'byterover-cli': {
              args: ['mcp'],
              command: 'brv',
            },
          },
        }, null, 2))
        terminal.log('')
        terminal.log('Run /mcp setup for detailed instructions.')
        terminal.log('')
      },
      type: 'streaming',
    }
  },
  aliases: [],
  autoExecute: true,
  description: 'Check MCP server readiness status',
  kind: CommandKind.BUILT_IN,
  name: 'status',
}
