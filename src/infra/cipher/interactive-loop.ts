/* eslint-disable unicorn/no-process-exit */
/* eslint-disable n/no-process-exit */
import chalk from 'chalk'
import readline from 'node:readline'

import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {AgentEventBus} from './events/event-emitter.js'

import {parseInput} from './command-parser.js'
import {executeCommand} from './interactive-commands.js'

/**
 * Prompt user for input using readline
 *
 * @param rl - Readline interface
 * @returns Promise resolving to user input
 */
function promptUser(rl: readline.Interface): Promise<string> {
  return new Promise((resolve, reject) => {
    // Ensure stdin is not paused
    if (process.stdin.isPaused()) {
      process.stdin.resume()
    }

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
      context: {model, sessionId},
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
  process.stdout.write('\r' + ' '.repeat(100) + '\r')
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
    // Write message on same line with carriage return
    clearTerminalLine()
    process.stdout.write(chalk.gray(`ℹ️  ${message}`))
  }
}

/**
 * Setup event listeners for spinner and error handling
 */
function setupEventListeners(
  eventBus: AgentEventBus,
  spinnerState: {
    frames: string[]
    indexRef: {value: number}
    isExecutingRef: {value: boolean}
    ref: {current: NodeJS.Timeout | null}
  },
): void {
  const {frames: spinnerFrames, indexRef: spinnerIndexRef, isExecutingRef, ref: spinnerRef} = spinnerState
  // Thinking event - start spinner
  eventBus.on('llmservice:thinking', () => {
    // Only start spinner if currently executing and not already running
    if (isExecutingRef.value && !spinnerRef.current) {
      // Start animated spinner
      spinnerRef.current = setInterval(() => {
        clearTerminalLine()
        process.stdout.write(chalk.gray(`💭 Agent thinking ${spinnerFrames[spinnerIndexRef.value]}`))
        spinnerIndexRef.value = (spinnerIndexRef.value + 1) % spinnerFrames.length
      }, 80)
    }
  })

  // Response event - clear spinner
  eventBus.on('llmservice:response', () => {
    if (spinnerRef.current) {
      clearInterval(spinnerRef.current)
      spinnerRef.current = null
      clearTerminalLine()
    }
  })

  // Tool call event - clear spinner before tool execution
  eventBus.on('llmservice:toolCall', () => {
    if (spinnerRef.current) {
      clearInterval(spinnerRef.current)
      spinnerRef.current = null
      clearTerminalLine()
    }
  })

  // Error event - SINGLE POINT where ALL errors are displayed
  // Clear spinner and display formatted error message
  eventBus.on('llmservice:error', (payload: {error: string}) => {
    // Stop spinner first
    if (spinnerRef.current) {
      clearInterval(spinnerRef.current)
      spinnerRef.current = null
      clearTerminalLine()
    }

    // Display error message (already formatted with ❌ from gRPC layer)
    process.stdout.write('\n' + chalk.red(payload.error) + '\n\n')
  })
}

/**
 * Stop and clear spinner if running
 */
function stopSpinner(spinnerRef: {current: NodeJS.Timeout | null}): void {
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
    isExecutingRef: {value: boolean}
    spinnerRef: {current: NodeJS.Timeout | null}
  },
  eventBus?: AgentEventBus,
): Promise<void> {
  const {isExecutingRef, spinnerRef} = state
  try {
    // Mark execution started - prevents late thinking events from starting spinner
    isExecutingRef.value = true

    // Execute AI prompt
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
  displayWelcome(options?.sessionId ?? 'cipher-agent-session', options?.model ?? 'gemini-2.5-pro')

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // Resume stdin
  process.stdin.resume()

  // Create custom spinner using carriage return for clean output
  const spinnerRef: {current: NodeJS.Timeout | null} = {current: null}
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const spinnerIndexRef = {value: 0}
  const isExecutingRef = {value: false}

  // Setup event listeners
  if (options?.eventBus) {
    setupEventListeners(options.eventBus, {
      frames: spinnerFrames,
      indexRef: spinnerIndexRef,
      isExecutingRef,
      ref: spinnerRef,
    })
  }

  const isExitingRef = {value: false}
  const exitEventHandler = async () => {
    stopSpinner(spinnerRef)
    await cleanup(agent, rl, isExitingRef, options?.eventBus)
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

      // Immediately pause stdin after getting input to prevent readline artifacts
      // promptUser will resume it on next iteration
      process.stdin.pause()

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

      // Execute AI prompt
      // eslint-disable-next-line no-await-in-loop -- Sequential agent execution required for interactive loop
      await executePrompt(parsed.rawInput, agent, {isExecutingRef, spinnerRef}, options?.eventBus)
    }
  } finally {
    stopSpinner(spinnerRef)
    await cleanup(agent, rl, isExitingRef, options?.eventBus)
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
const cleanup = async (
  agent: ICipherAgent,
  rl: readline.Interface,
  isExitingRef: {value: boolean},
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
