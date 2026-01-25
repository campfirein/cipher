/* eslint-disable unicorn/no-process-exit */
/* eslint-disable n/no-process-exit */
import chalk from 'chalk'
import readline from 'node:readline'

import type { ICipherAgent } from './interfaces/i-cipher-agent.js'
import type { AgentEventBus } from './events/event-emitter.js'

import { parseInput } from './command-parser.js'
import { executeCommand } from './interactive-commands.js'

/**
 * Prompt user for input using readline
 *
 * @param rl - Readline interface
 * @returns Promise resolving to user input
 */
function promptUser(rl: readline.Interface): Promise<string> {
  return new Promise((resolve, reject) => {
    // Set the prompt and display it immediately
    const prompt = chalk.cyan('💬 You: ')
    rl.setPrompt(prompt)
    rl.prompt()

    // Listen for line event instead of using question()
    // This ensures the prompt appears immediately
    const lineHandler = (answer: string) => {
      rl.removeListener('line', lineHandler)
      rl.removeListener('close', closeHandler)
      resolve(answer)
    }

    const closeHandler = () => {
      rl.removeListener('line', lineHandler)
      rl.removeListener('close', closeHandler)
      reject(new Error('Readline closed unexpectedly'))
    }

    rl.on('line', lineHandler)
    rl.on('close', closeHandler)
  })
}

/**
 * Display welcome message for interactive mode
 *
 * @param sessionId - Session identifier
 * @param model - LLM model name
 * @param eventBus - Event bus to emit UI events
 */
function displayWelcome(sessionId: string, model: string, eventBus?: AgentEventBus): void {
  if (eventBus) {
    eventBus.emit('cipher:ui', {
      context: { model, sessionId },
      type: 'banner',
    })
  }
}

/**
 * Format and display AI response
 *
 * @param response - AI response text
 * @param eventBus - Event bus to emit UI events
 */
function displayResponse(response: string, eventBus?: AgentEventBus): void {
  if (eventBus) {
    eventBus.emit('cipher:ui', {
      message: response,
      type: 'response',
    })
  }
}

/**
 * Safely clear the current terminal line
 * Uses carriage return and spaces instead of ANSI codes to avoid rendering issues
 */
function clearTerminalLine(): void {
  // Clear line by overwriting with spaces, then return to start
  // Use terminal width or 200 chars (enough for long error messages)
  const width = process.stdout.columns || 200
  process.stdout.write('\r' + ' '.repeat(width) + '\r')
}

/**
 * Display system information message on the same line using carriage return
 * This allows messages to overwrite each other for cleaner output
 *
 * @param message - Info message to display
 * @param clear - If true, clear the line after displaying (for completed actions)
 */
export function displayInfo(message: string, clear = false): void {
  if (clear) {
    // Clear the current line completely
    clearTerminalLine()
  } else {
    // Clear current line (spinner), write message, then newline to persist it
    clearTerminalLine()
    // Don't use gray - use default color for better visibility
    process.stdout.write(message + '\n')
  }
}

/**
 * Setup event listeners for spinner and error handling
 * @returns Cleanup function to remove all listeners (prevents memory leaks)
 */
function setupEventListeners(
  eventBus: AgentEventBus,
  spinnerState: {
    frames: string[]
    indexRef: { value: number }
    isExecutingRef: { value: boolean }
    ref: { current: NodeJS.Timeout | null }
  },
): () => void {
  const { frames: spinnerFrames, indexRef: spinnerIndexRef, isExecutingRef, ref: spinnerRef } = spinnerState

  // Store listener references for cleanup
  const thinkingListener = (): void => {
    if (isExecutingRef.value && !spinnerRef.current) {
      spinnerRef.current = setInterval(() => {
        clearTerminalLine()
        process.stdout.write(chalk.gray(`💭 Agent thinking ${spinnerFrames[spinnerIndexRef.value]}`))
        spinnerIndexRef.value = (spinnerIndexRef.value + 1) % spinnerFrames.length
      }, 80)
    }
  }

  const responseListener = (): void => {
    if (spinnerRef.current) {
      clearInterval(spinnerRef.current)
      spinnerRef.current = null
      clearTerminalLine()
    }
  }

  const toolCallListener = (): void => {
    if (spinnerRef.current) {
      clearInterval(spinnerRef.current)
      spinnerRef.current = null
      clearTerminalLine()
    }
  }

  const errorListener = (payload: { error: string }): void => {
    if (spinnerRef.current) {
      clearInterval(spinnerRef.current)
      spinnerRef.current = null
      clearTerminalLine()
    }

    process.stdout.write('\n' + chalk.red(payload.error) + '\n\n')
  }

  // eslint-disable-next-line no-warning-comments -- Tracked for v0.5.0 release
  // TODO(v0.5.0): Move to outer scope for better performance
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const uiListener = (payload: { context?: unknown; message?: string; type: string }): void => {
    switch (payload.type) {
      case 'banner': {
        const { model, sessionId } = payload.context as { model: string; sessionId: string }
        console.log('\n' + chalk.cyan('═'.repeat(60)))
        console.log(chalk.bold.cyan('🤖 CipherAgent Interactive Mode'))
        console.log(chalk.cyan('═'.repeat(60)))
        console.log(chalk.gray(`Model: ${model}`))
        console.log(chalk.gray(`Session: ${sessionId}`))
        console.log(chalk.yellow('\nType /help for available commands'))
        console.log(chalk.cyan('─'.repeat(60)) + '\n')
        break
      }

      case 'help': {
        if (payload.message) {
          console.log(chalk.yellow(`ℹ ${payload.message}`))
        }

        break
      }

      case 'response': {
        if (payload.message) {
          console.log('\n' + chalk.rgb(255, 165, 0)('─'.repeat(60)))
          console.log(chalk.bold.rgb(255, 165, 0)('🤖 AI Response:'))
          console.log(chalk.rgb(255, 165, 0)('─'.repeat(60)))
          console.log(chalk.white(payload.message))
          console.log(chalk.rgb(255, 165, 0)('─'.repeat(60)) + '\n')
        }

        break
      }

      case 'shutdown': {
        if (payload.message) {
          console.log(chalk.gray(`✓ ${payload.message}`))
        }

        break
      }
    }
  }

  // eslint-disable-next-line no-warning-comments -- Tracked for v0.5.0 release
  // TODO(v0.5.0): Move to outer scope for better performance
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const logListener = (payload: { level: string; message: string; source?: string }): void => {
    const prefix = payload.source ? `[${payload.source}] ` : ''
    const message = `${prefix}${payload.message}`

    switch (payload.level) {
      case 'debug': {
        console.log(chalk.gray(`🔍 ${message}`))
        break
      }

      case 'error': {
        // Skip - llmservice:error handler displays errors to avoid duplicates
        break
      }

      case 'info': {
        console.log(chalk.blue(`ℹ ${message}`))
        break
      }

      case 'warn': {
        console.warn(chalk.yellow(`⚠ ${message}`))
        break
      }
    }
  }

  // Register all listeners
  eventBus.on('llmservice:thinking', thinkingListener)
  eventBus.on('llmservice:response', responseListener)
  eventBus.on('llmservice:toolCall', toolCallListener)
  eventBus.on('llmservice:error', errorListener)
  eventBus.on('cipher:ui', uiListener)
  eventBus.on('cipher:log', logListener)

  // Return cleanup function to remove all listeners
  return () => {
    eventBus.off('llmservice:thinking', thinkingListener)
    eventBus.off('llmservice:response', responseListener)
    eventBus.off('llmservice:toolCall', toolCallListener)
    eventBus.off('llmservice:error', errorListener)
    eventBus.off('cipher:ui', uiListener)
    eventBus.off('cipher:log', logListener)
  }
}

/**
 * Stop and clear spinner if running
 */
function stopSpinner(spinnerRef: { current: NodeJS.Timeout | null }): void {
  if (spinnerRef.current) {
    clearInterval(spinnerRef.current)
    spinnerRef.current = null
    clearTerminalLine()
  }
}

/**
 * Handle command execution
 * @returns true to continue loop, false to exit
 */
async function handleCommand(
  command: string | undefined,
  args: string[],
  agent: ICipherAgent,
  eventBus?: AgentEventBus,
): Promise<boolean> {
  if (!command) {
    if (eventBus) {
      eventBus.emit('cipher:ui', {
        message: 'Type /help to see available commands',
        type: 'help',
      })
    }

    return true
  }

  const shouldContinue = await executeCommand(command, args, agent)
  return shouldContinue
}

/**
 * Execute user prompt with AI agent
 */
async function executePrompt(
  prompt: string,
  agent: ICipherAgent,
  state: {
    isExecutingRef: { value: boolean }
    spinnerRef: { current: NodeJS.Timeout | null }
  },
  eventBus?: AgentEventBus,
): Promise<void> {
  const { isExecutingRef, spinnerRef } = state
  try {
    // Mark execution started - prevents late thinking events from starting spinner
    isExecutingRef.value = true

    // Execute AI prompt (agent uses its default session)
    const response = await agent.execute(prompt)

    // Mark execution finished - no more spinners allowed
    isExecutingRef.value = false

    // Stop spinner immediately after execution completes (redundant safety check)
    stopSpinner(spinnerRef)

    // Display response
    displayResponse(response, eventBus)

    // Final safety cleanup - ensure no spinner is running after response displayed
    stopSpinner(spinnerRef)
  } catch {
    // Mark execution finished on error
    isExecutingRef.value = false

    // Error is already handled by llmservice:error event listener
    // No need to display here - just clean up state
  }
}

/**
 * Start interactive loop for CipherAgent
 *
 * @param agent - CipherAgent instance
 * @param options - Optional configuration
 * @param options.model - LLM model name
 * @param options.sessionId - Session identifier
 * @param options.eventBus - Optional event bus for listening to agent events
 */
export async function startInteractiveLoop(
  agent: ICipherAgent,
  options?: {
    eventBus?: AgentEventBus
    model?: string
    sessionId?: string
  },
): Promise<void> {
  // Display welcome message
  displayWelcome(options?.sessionId ?? 'cipher-agent-session', options?.model ?? 'gemini-3-flash-preview', options?.eventBus)

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // Create custom spinner using carriage return for clean output
  const spinnerRef: { current: NodeJS.Timeout | null } = { current: null }
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const spinnerIndexRef = { value: 0 }
  const isExecutingRef = { value: false }

  // Setup event listeners and get cleanup function
  let cleanupEventListeners: (() => void) | undefined
  if (options?.eventBus) {
    cleanupEventListeners = setupEventListeners(options.eventBus, {
      frames: spinnerFrames,
      indexRef: spinnerIndexRef,
      isExecutingRef,
      ref: spinnerRef,
    })
  }

  const isExitingRef = { value: false }
  const exitEventHandler = async () => {
    stopSpinner(spinnerRef)
    cleanupEventListeners?.()
    await cleanup(agent, rl, isExitingRef, options?.eventBus)
    process.exit(0)
  }

  rl.on('SIGINT', exitEventHandler)
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
        // eslint-disable-next-line no-await-in-loop -- Sequential command execution required for interactive loop
        const shouldContinue = await handleCommand(parsed.command, parsed.args || [], agent, options?.eventBus)

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

      // Execute AI prompt (agent uses its default session)
      // eslint-disable-next-line no-await-in-loop -- Sequential agent execution required for interactive loop
      await executePrompt(parsed.rawInput, agent, { isExecutingRef, spinnerRef }, options?.eventBus)
    }
  } finally {
    stopSpinner(spinnerRef)
    cleanupEventListeners?.()
    await cleanup(agent, rl, isExitingRef, options?.eventBus)
    rl.off('SIGINT', exitEventHandler)
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
const cleanup = async (
  agent: ICipherAgent,
  rl: readline.Interface,
  isExitingRef: { value: boolean },
  eventBus?: AgentEventBus,
): Promise<void> => {
  if (isExitingRef.value) return
  isExitingRef.value = true
  if (eventBus) {
    eventBus.emit('cipher:ui', {
      message: 'Shutting down...',
      type: 'shutdown',
    })
  }

  rl.close()
  console.log(chalk.gray('✓ Cleanup complete'))
}
