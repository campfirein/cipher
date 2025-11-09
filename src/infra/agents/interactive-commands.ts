import chalk from 'chalk'

import type {ICipherAgent} from '../../core/interfaces/i-cipher-agent.js'

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
      console.log(
        chalk.white(`  Execution history entries: ${chalk.bold(state.executionHistory.length.toString())}`),
      )

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
 * Execute an interactive command
 *
 * @param command - Command name
 * @param args - Command arguments
 * @param agent - CipherAgent instance
 * @returns Promise<boolean> - true to continue loop, false to exit
 */
export async function executeCommand(
  command: string,
  args: string[],
  agent: ICipherAgent,
): Promise<boolean> {
  // Find the command (including aliases)
  const cmd = INTERACTIVE_COMMANDS.find(
    (c) => c.name === command || (c.aliases && c.aliases.includes(command)),
  )

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
