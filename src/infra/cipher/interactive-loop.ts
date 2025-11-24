/* eslint-disable unicorn/no-process-exit */
/* eslint-disable n/no-process-exit */
import chalk from 'chalk'
import readline from 'node:readline'

import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'

import {parseInput} from './command-parser.js'
import {executeCommand} from './interactive-commands.js'

/**
 * Prompt user for input using readline
 *
 * @param rl - Readline interface
 * @returns Promise resolving to user input
 */
function promptUser(rl: readline.Interface): Promise<string> {
  return new Promise((resolve) => {
    // Set the prompt and display it immediately
    const prompt = chalk.cyan('💬 You: ')
    rl.setPrompt(prompt)
    rl.prompt()

    // Listen for line event instead of using question()
    // This ensures the prompt appears immediately
    const lineHandler = (answer: string) => {
      rl.removeListener('line', lineHandler)
      resolve(answer)
    }

    rl.on('line', lineHandler)
  })
}

/**
 * Display welcome message for interactive mode
 *
 * @param sessionId - Session identifier
 * @param model - LLM model name
 */
function displayWelcome(sessionId: string, model: string): void {
  console.log('\n' + chalk.cyan('═'.repeat(60)))
  console.log(chalk.bold.cyan('🤖 CipherAgent Interactive Mode'))
  console.log(chalk.cyan('═'.repeat(60)))
  console.log(chalk.gray(`Model: ${model}`))
  console.log(chalk.gray(`Session: ${sessionId}`))
  console.log(chalk.yellow('\nType /help for available commands'))
  console.log(chalk.cyan('─'.repeat(60)) + '\n')
}

/**
 * Format and display AI response
 *
 * @param response - AI response text
 */
function displayResponse(response: string): void {
  console.log('\n' + chalk.rgb(255, 165, 0)('─'.repeat(60)))
  console.log(chalk.bold.rgb(255, 165, 0)('🤖 AI Response:'))
  console.log(chalk.rgb(255, 165, 0)('─'.repeat(60)))
  console.log(chalk.white(response))
  console.log(chalk.rgb(255, 165, 0)('─'.repeat(60)) + '\n')
}

/**
 * Display system information message
 *
 * @param message - Info message to display
 */
export function displayInfo(message: string): void {
  console.log(chalk.gray(`ℹ️  ${message}`))
}

/**
 * Start interactive loop for CipherAgent
 *
 * @param agent - CipherAgent instance
 * @param options - Optional configuration
 * @param options.model - LLM model name
 * @param options.sessionId - Session identifier
 */
export async function startInteractiveLoop(
  agent: ICipherAgent,
  options?: {
    model?: string
    sessionId?: string
  },
): Promise<void> {
  // Display welcome message
  displayWelcome(options?.sessionId ?? 'cipher-agent-session', options?.model ?? 'gemini-2.5-flash')

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // Resume stdin
  // TODO: consider removing this since rl already handles stdin resuming.
  process.stdin.resume()

  const isExitingRef = {value: false}
  const exitEventHandler = async () => {
    await cleanup(agent, rl, isExitingRef)
    process.exit(0)
  }

  process.on('SIGINT', exitEventHandler)
  process.on('SIGTERM', exitEventHandler)

  try {
    // Main interactive loop
    while (true) {
      // Get user input
      // eslint-disable-next-line no-await-in-loop -- Sequential user input required for interactive loop
      const userInput = await promptUser(rl)

      // Parse input
      const parsed = parseInput(userInput)

      if (parsed.type === 'command') {
        // Handle slash command
        if (!parsed.command) {
          console.log('\n' + chalk.yellow('💡 Type /help to see available commands\n'))
          continue
        }

        // eslint-disable-next-line no-await-in-loop -- Sequential command execution required for interactive loop
        const shouldContinue = await executeCommand(parsed.command, parsed.args || [], agent)

        if (!shouldContinue) {
          // Exit command was called
          break
        }

        continue
      }

      // Handle regular prompt - pass to AI
      if (!parsed.rawInput.trim()) {
        // Empty input, skip
        continue
      }

      try {
        // Execute AI prompt
        // eslint-disable-next-line no-await-in-loop -- Sequential agent execution required for interactive loop
        const response = await agent.execute(parsed.rawInput)

        // Display response
        displayResponse(response)
      } catch (error) {
        // Handle execution error
        console.error('\n' + chalk.red('❌ Error executing prompt:'))
        console.error(chalk.red(error instanceof Error ? error.message : String(error)))
        console.log()
      }
    }
  } finally {
    await cleanup(agent, rl, isExitingRef)
    process.off('SIGINT', exitEventHandler)
    process.off('SIGTERM', exitEventHandler)
  }
}

/**
 * Cleans up resources when interactive loop is exiting.
 * @param agent CipherAgent instance to stop
 * @param rl Readline interface to close
 * @param isExitingRef Reference object to track if exiting
 * @param isExitingRef.value Boolean flag indicating if cleanup is in progress
 */
const cleanup = async (agent: ICipherAgent, rl: readline.Interface, isExitingRef: {value: boolean}): Promise<void> => {
  if (isExitingRef.value) return
  isExitingRef.value = true
  console.log('\n' + chalk.yellow('👋 Shutting down...'))
  rl.close()
  console.log(chalk.gray('✓ Cleanup complete'))
}
