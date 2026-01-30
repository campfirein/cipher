import chalk from 'chalk'

import type {ICipherAgent} from '../../core/interfaces/i-cipher-agent.js'

/**
 * Format a timestamp as a human-readable "time ago" string.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Human-readable time ago string (e.g., "2 hours ago", "3 days ago")
 */
function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) {
    return 'just now'
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  }

  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  }

  if (diffDays < 30) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  }

  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`
}

/**
 * Interactive command definition
 */
interface InteractiveCommand {
  aliases?: string[]
  description: string
  handler: (args: string[], agent: ICipherAgent) => Promise<boolean>
  name: string
  usage?: string
}

/**
 * Available interactive commands
 */
const INTERACTIVE_COMMANDS: InteractiveCommand[] = [
  {
    aliases: ['?'],
    description: 'Show available commands',
    async handler() {
      console.log('\n' + chalk.bold.cyan('📋 Available Commands:'))
      console.log(chalk.cyan('─'.repeat(60)))

      for (const cmd of INTERACTIVE_COMMANDS) {
        const aliases = cmd.aliases ? chalk.gray(` (${cmd.aliases.join(', ')})`) : ''
        console.log(chalk.green(`  /${cmd.name}`) + aliases)
        console.log(chalk.white(`    ${cmd.description}`))

        if (cmd.usage) {
          console.log(chalk.gray(`    Usage: ${cmd.usage}`))
        }

        console.log()
      }

      return true // Continue loop
    },
    name: 'help',
  },
  {
    description: 'Clear conversation history',
    async handler(_args, agent) {
      agent.reset()
      console.log('\n' + chalk.green('✓ Conversation history cleared'))
      return true // Continue loop
    },
    name: 'reset',
  },
  {
    description: 'Show agent state',
    async handler(_args, agent) {
      const state = agent.getState()
      console.log('\n' + chalk.bold.cyan('📊 Agent State:'))
      console.log(chalk.cyan('─'.repeat(60)))
      console.log(chalk.white(`  Iterations: ${chalk.bold(state.currentIteration.toString())}`))
      console.log(chalk.white(`  Execution history entries: ${chalk.bold(state.executionHistory.length.toString())}`))

      if (state.executionHistory.length > 0) {
        console.log(chalk.white('\n  Recent executions:'))

        const recent = state.executionHistory.slice(-3)
        for (const entry of recent) {
          console.log(chalk.gray(`    • ${entry}`))
        }
      }

      console.log()
      return true // Continue loop
    },
    name: 'status',
  },
  {
    description: 'List all persisted sessions',
    async handler(_args, agent) {
      console.log('\n' + chalk.bold.cyan('📋 Available Sessions:'))
      console.log(chalk.cyan('─'.repeat(60)))

      const sessionIds = await agent.listPersistedSessions()

      if (sessionIds.length === 0) {
        console.log(chalk.gray('  No sessions found'))
        console.log()
        return true
      }

      // Load metadata for each session and sort by last activity
      const sessions = []
      for (const sessionId of sessionIds) {
        // eslint-disable-next-line no-await-in-loop -- Sequential metadata loading required
        const metadata = await agent.getSessionMetadata(sessionId)
        if (metadata) {
          sessions.push(metadata)
        }
      }

      // Sort by last activity (most recent first)
      sessions.sort((a, b) => b.lastActivity - a.lastActivity)

      // Display sessions
      for (const session of sessions) {
        const timeAgo = formatTimeAgo(session.lastActivity)
        console.log(chalk.green(`  • ${session.sessionId}`))
        console.log(chalk.white(`    ${session.messageCount} messages, ${timeAgo}`))
      }

      console.log()
      return true // Continue loop
    },
    name: 'sessions',
  },
  {
    description: 'Delete a session',
    async handler(args, agent) {
      if (args.length === 0) {
        console.log('\n' + chalk.red('❌ Session ID is required'))
        console.log(chalk.yellow('Usage: /delete <sessionId>'))
        console.log()
        return true
      }

      const sessionId = args[0]

      // Check if session exists
      const metadata = await agent.getSessionMetadata(sessionId)
      if (!metadata) {
        console.log('\n' + chalk.red(`❌ Session '${sessionId}' not found`))
        console.log()
        return true
      }

      // Delete the session
      const deleted = await agent.deleteSession(sessionId)

      if (deleted) {
        console.log('\n' + chalk.green(`✓ Deleted session: ${sessionId}`))
      } else {
        console.log('\n' + chalk.yellow(`⚠️  Session '${sessionId}' was not in memory`))
      }

      console.log()
      return true // Continue loop
    },
    name: 'delete',
    usage: '/delete <sessionId>',
  },
  {
    aliases: ['quit', 'q'],
    description: 'Exit interactive mode',
    async handler() {
      console.log('\n' + chalk.yellow('👋 Goodbye!'))
      return false // Exit loop
    },
    name: 'exit',
  },
]

/**
 * Get all available command names (including aliases) for autocomplete
 *
 * @returns Array of command names with '/' prefix
 */
export function getCommandNames(): string[] {
  const names: string[] = []

  for (const cmd of INTERACTIVE_COMMANDS) {
    names.push(`/${cmd.name}`)

    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        names.push(`/${alias}`)
      }
    }
  }

  return names
}

/**
 * Execute an interactive command
 *
 * @param command - Command name
 * @param args - Command arguments
 * @param agent - CipherAgent instance
 * @returns Promise<boolean> - true to continue loop, false to exit
 */
export async function executeCommand(command: string, args: string[], agent: ICipherAgent): Promise<boolean> {
  // Find the command (including aliases)
  const cmd = INTERACTIVE_COMMANDS.find((c) => c.name === command || (c.aliases && c.aliases.includes(command)))

  if (!cmd) {
    console.log('\n' + chalk.red(`❌ Unknown command: /${command}`))
    console.log(chalk.yellow('Type /help to see available commands\n'))
    return true // Continue loop
  }

  try {
    return await cmd.handler(args, agent) // Execute command handler
  } catch (error) {
    console.error('\n' + chalk.red(`❌ Error executing command /${command}:`))
    console.error(chalk.red(error instanceof Error ? error.message : String(error)))
    console.log()
    return true // Continue loop on error
  }
}
