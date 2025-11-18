import {Args, Command, Flags} from '@oclif/core'
import fs from 'node:fs'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'

import {getCurrentConfig} from '../../config/environment.js'
import { PROJECT } from '../../constants.js'
import {CipherAgent} from '../../infra/cipher/cipher-agent.js'
import {ExitCode, exitWithCode} from '../../infra/cipher/exit-codes.js'
import {displayInfo, startInteractiveLoop} from '../../infra/cipher/interactive-loop.js'
import {WorkspaceNotInitializedError} from '../../infra/cipher/validation/workspace-validator.js'
import {ProjectConfigStore} from '../../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../../infra/storage/keychain-token-store.js'
import {formatToolCall, formatToolResult} from '../../utils/tool-display-formatter.js'

export default class CipherAgentRun extends Command {
  static override args = {
    prompt: Args.string({
      description: 'The prompt to send to CipherAgent (optional in interactive mode)',
      required: false,
    }),
  }
  static override description = 'Run CipherAgent in interactive or single-execution mode'
  static override examples = [
    '# Interactive mode (creates new unique session each time)',
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --interactive',
    '',
    '# Continue most recent session in interactive mode',
    '<%= config.bin %> <%= command.id %> -c',
    '<%= config.bin %> <%= command.id %> -c -i',
    '',
    '# Resume specific session in interactive mode',
    '<%= config.bin %> <%= command.id %> -r session-1731686400123-a7b3c9',
    '<%= config.bin %> <%= command.id %> -r session-1731686400123-a7b3c9 -i',
    '',
    '# Single execution mode (creates new unique session)',
    '<%= config.bin %> <%= command.id %> "Analyze the project structure" --no-interactive',
    '<%= config.bin %> <%= command.id %> "Find all TypeScript files" --no-interactive',
    '',
    '# Continue session with a new prompt (headless)',
    '<%= config.bin %> <%= command.id %> -c "What did we discuss?"',
    '<%= config.bin %> <%= command.id %> -r session-1731686400123-a7b3c9 "Continue implementation"',
    '',
    '# Process JSON data with default prompt',
    '<%= config.bin %> <%= command.id %> -j data.json',
    '',
    '# Process JSON with custom prompt',
    '<%= config.bin %> <%= command.id %> "analyze this data for patterns" -j data.json',
    '',
    '# Process JSON with session continuation',
    '<%= config.bin %> <%= command.id %> -j data.json -c',
    '',
    '# Process JSON with verbose output',
    '<%= config.bin %> <%= command.id %> -j data.json -v',
    '',
    '# Piped input (automatically uses non-interactive mode)',
    'echo "Analyze the codebase" | <%= config.bin %> <%= command.id %>',
    '',
    '# Specify working directory',
    '<%= config.bin %> <%= command.id %> -w /path/to/project',
    '<%= config.bin %> <%= command.id %> --working-directory ~/myproject',
  ]
  static override flags = {
    apiKey: Flags.string({
      char: 'k',
      description: 'OpenRouter API key (use OpenRouter instead of gRPC backend)',
      env: 'OPENROUTER_API_KEY',
    }),
    continue: Flags.boolean({
      char: 'c',
      description: 'Continue most recent session (requires prompt in headless mode)',
    }),
    inputJson: Flags.string({
      char: 'j',
      description: 'Path to JSON file to process (any format)',
    }),
    interactive: Flags.boolean({
      allowNo: true,
      char: 'i',
      description: 'Enable interactive mode (auto-detected from TTY if not specified)',
    }),
    maxTokens: Flags.integer({
      char: 't',
      description: 'Maximum tokens in response (default: 8192)',
    }),
    model: Flags.string({
      char: 'm',
      description: 'Model to use (default: anthropic/claude-haiku-4.5 for OpenRouter, gemini-2.5-flash for gRPC)',
    }),
    resume: Flags.string({
      char: 'r',
      description: 'Resume specific session by ID (requires prompt in headless mode)',
    }),
    temperature: Flags.string({
      char: 'T',
      description: 'Temperature for randomness 0-1 (default: 0.7)',
    }),
    verbose: Flags.boolean({
      char: 'v',
      default: false,
      description: 'Enable verbose debug output for prompt loading and agent operations',
    }),
    workingDirectory: Flags.string({
      char: 'w',
      description: 'Working directory for file operations (default: current directory)',
    }),
  }

  protected createServices(): {
    projectConfigStore: IProjectConfigStore
  } {
    return {
      projectConfigStore: new ProjectConfigStore(),
    }
  }

  /**
   * Generate a unique session ID with timestamp and random component.
   *
   * Format: "session-{timestamp}-{random}"
   * Example: "session-1731686400123-a7b3c9"
   *
   * @returns Unique session ID string
   */
  protected generateSessionId(): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `${timestamp}-${random}`
  }

  /**
   * Get the most recent session ID from history storage.
   *
   * @param agent - CipherAgent instance
   * @returns Most recent session ID or undefined if no sessions found
   */
  protected async getMostRecentSessionId(agent: import('../../infra/cipher/cipher-agent.js').CipherAgent): Promise<string | undefined> {
    // Get all session IDs from persisted storage
    const sessionIds = await agent.listPersistedSessions()

    if (sessionIds.length === 0) {
      return undefined
    }

    // Get metadata for all sessions to find most recent
    let mostRecentId: string | undefined
    let mostRecentActivity = 0

    for (const sessionId of sessionIds) {
      // eslint-disable-next-line no-await-in-loop -- Sequential metadata loading required
      const metadata = await agent.getSessionMetadata(sessionId)

      if (metadata && metadata.lastActivity > mostRecentActivity) {
        mostRecentActivity = metadata.lastActivity
        mostRecentId = sessionId
      }
    }

    return mostRecentId
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(CipherAgentRun)

    try {
      // Get authentication token from keychain
      const tokenStore = new KeychainTokenStore()
      const token = await tokenStore.load()
      if (!token) {
        exitWithCode(ExitCode.CONFIG_ERROR, 'Authentication required. Please run "brv login" first.')
      }

      // Construct the prompt
      let currentPrompt: string
      let jsonInputMode = false

      if (flags.inputJson) {
        // Read and parse JSON file
        const jsonData = this.readAndParseJson(flags.inputJson)

        // Use custom prompt if provided, otherwise use default
        const basePrompt = args.prompt || 'process the task for building the context tree with the data'

        // Combine prompt with JSON data
        currentPrompt = `${basePrompt}\n\n${jsonData}`
        jsonInputMode = true
      } else if (args.prompt) {
        currentPrompt = args.prompt
      } else {
        currentPrompt = '' // Will be handled by interactive mode
      }

      // Determine interactive mode
      // Priority: explicit flag > TTY detection
      // Note: JSON input mode is always non-interactive
      const isInteractive: boolean = jsonInputMode
        ? false
        : flags.interactive === undefined
          ? process.stdin.isTTY === true // Auto-detect from TTY
          : flags.interactive // User explicitly set --interactive or --no-interactive

      // Validate prompt requirement for non-interactive mode
      if (!isInteractive && !currentPrompt) {
        this.error('Prompt is required in non-interactive mode. Use --interactive flag for interactive mode.')
      }

      // Validate flags: In headless mode, prompt is required for session continuation
      if ((flags.continue || flags.resume) && !isInteractive && !args.prompt) {
        this.error('Session continuation flags (-c/--continue or -r/--resume) require a prompt in headless mode.')
      }

      // Load ByteRover config to get custom system prompt (if configured)
      const {projectConfigStore} = this.createServices()
      const brvConfig = await projectConfigStore.read()

      // Create LLM configuration
      const llmConfig = this.createLLMConfig(token, flags)

      // Create CipherAgent with service factory pattern
      const agent = new CipherAgent(llmConfig, brvConfig)

      this.log('Starting CipherAgent...')
      await agent.start()

      // Resolve session ID based on flags
      const resolvedSessionId = await this.resolveSessionId(agent, flags)

      // Setup event listeners
      this.setupEventListeners(agent, isInteractive)

      if (isInteractive) {
        // Interactive mode: start the loop
        await startInteractiveLoop(agent, {
          model: llmConfig.model,
          sessionId: resolvedSessionId,
        })
      } else {
        // Non-interactive mode: single execution
        if (!currentPrompt) {
          this.error('Prompt is required in non-interactive mode.')
        }

        this.log('Executing prompt...')
        const response = await agent.execute(
          currentPrompt,
          resolvedSessionId,
          jsonInputMode ? {mode: 'json-input'} : undefined,
        )

        this.log('\nCipherAgent Response:')
        this.log(response)

        // Show agent state
        const state = agent.getState()
        this.log(`\n[Agent State: ${state.currentIteration} iterations]`)
      }
    } catch (error) {
      // Handle workspace not initialized error with friendly message
      if (error instanceof WorkspaceNotInitializedError) {
        this.handleWorkspaceError(error)
        return
      }

      // Generic error handling with proper exit code
      exitWithCode(ExitCode.RUNTIME_ERROR, `Failed to execute CipherAgent: ${(error as Error).message}`)
    }
  }

  /**
   * Validate that a session exists in storage.
   *
   * @param agent - CipherAgent instance
   * @param sessionId - Session ID to validate
   * @returns True if session exists
   */
  protected async validateSessionExists(agent: import('../../infra/cipher/cipher-agent.js').CipherAgent, sessionId: string): Promise<boolean> {
    const metadata = await agent.getSessionMetadata(sessionId)
    return metadata !== undefined
  }

  /**
   * Create LLM configuration from flags and environment
   *
   * @param token - Authentication token
   * @param token.accessToken - Access token for authentication
   * @param token.sessionKey - Session key for authentication
   * @param flags - Command flags
   * @param flags.apiKey - OpenRouter API key for direct service (optional)
   * @param flags.maxTokens - Maximum tokens in response
   * @param flags.model - Model to use
   * @param flags.temperature - Temperature for randomness
   * @param flags.verbose - Enable verbose debug output
   * @param flags.workingDirectory - Working directory for file operations
   * @returns LLM configuration object
   */
  private createLLMConfig(
    token: {accessToken: string; sessionKey: string},
    flags: {apiKey?: string; maxTokens?: number; model?: string; temperature?: string; verbose?: boolean; workingDirectory?: string},
  ): {
    accessToken: string
    fileSystemConfig?: {workingDirectory: string}
    grpcEndpoint: string
    maxIterations: number
    maxTokens: number
    model: string
    openRouterApiKey?: string
    projectId: string
    sessionKey: string
    temperature: number
    verbose?: boolean
  } {
    // Default model: anthropic/anthropic/claude-haiku-4.5 for OpenRouter, gemini-2.5-flash for gRPC
    const model = flags.model ?? (flags.apiKey ? 'anthropic/claude-haiku-4.5' : 'gemini-2.5-flash')
    const envConfig = getCurrentConfig()

    return {
      accessToken: token.accessToken,
      fileSystemConfig: flags.workingDirectory ? {workingDirectory: flags.workingDirectory} : undefined,
      grpcEndpoint: envConfig.llmGrpcEndpoint,
      maxIterations: 10, // Hardcoded default
      maxTokens: flags.maxTokens ?? 8192, // Default: 8192
      model,
      openRouterApiKey: flags.apiKey, // Map -k flag to OpenRouter API key
      projectId: PROJECT,
      sessionKey: token.sessionKey,
      temperature: flags.temperature ? Number.parseFloat(flags.temperature) : 0.7, // Default: 0.7
      verbose: flags.verbose ?? false,
    }
  }

  /**
   * Format tool call for concise display in interactive mode
   *
   * @param toolName - Name of the tool
   * @param args - Tool arguments
   * @returns Formatted string for display
   */
  private formatToolForInteractive(toolName: string, args: Record<string, unknown>): string {
    // Special case for bash_exec - just show the command
    if (toolName === 'bash_exec' && args.command) {
      const cmd = String(args.command)
      // Truncate long commands but keep readable
      return cmd.length > 100 ? cmd.slice(0, 97) + '...' : cmd
    }

    // For other tools, use the existing formatter
    const formatted = formatToolCall(toolName, args)

    // Remove the tool name prefix since we show it separately
    // formatToolCall returns: "tool_name(arg1: val1, ...)"
    // We want: "(arg1: val1, ...)" or just the args portion
    const argsOnly = formatted.replace(new RegExp(`^${toolName}\\s*`), '')

    return argsOnly
  }

  /**
   * Handle workspace not initialized error with friendly message
   *
   * @param error - WorkspaceNotInitializedError instance
   */
  private handleWorkspaceError(error: WorkspaceNotInitializedError): void {
    const message = [
      '\n⚠️  ByteRover workspace not found!\n',
      'It looks like you haven\'t initialized ByteRover in this directory yet.',
      'To get started, please run:\n',
      '  $ brv init\n',
      'This will create the necessary workspace structure in:',
      `  ${error.expectedPath}\n`,
      'After initialization, you can run cipher-agent again.',
    ].join('\n')

    exitWithCode(ExitCode.VALIDATION_ERROR, message)
  }

  /**
   * Read and parse a JSON file
   *
   * @param filePath - Path to JSON file
   * @returns Pretty-printed JSON string
   */
  private readAndParseJson(filePath: string): string {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(fileContent)
      return JSON.stringify(parsed, null, 2) // Pretty print for readability
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`JSON file not found: ${filePath}`)
      }

      throw new Error(`Invalid JSON in file ${filePath}: ${(error as Error).message}`)
    }
  }

  /**
   * Resolve session ID based on flags
   *
   * @param agent - CipherAgent instance
   * @param flags - Command flags
   * @param flags.continue - Continue most recent session flag
   * @param flags.resume - Resume specific session flag
   * @returns Resolved session ID
   */
  private async resolveSessionId(
    agent: import('../../infra/cipher/cipher-agent.js').CipherAgent,
    flags: {continue?: boolean; resume?: string},
  ): Promise<string> {
    // Validate flags: -c and -r are mutually exclusive
    if (flags.continue && flags.resume) {
      exitWithCode(ExitCode.VALIDATION_ERROR, 'Cannot use both -c/--continue and -r/--resume flags together. Choose one.')
    }

    if (flags.resume) {
      // Resume specific session by ID
      const sessionExists = await this.validateSessionExists(agent, flags.resume)

      if (!sessionExists) {
        exitWithCode(
          ExitCode.VALIDATION_ERROR,
          `Session '${flags.resume}' not found. Use 'brv cipher-agent sessions' to see available sessions.`,
        )
      }

      const metadata = await agent.getSessionMetadata(flags.resume)
      this.log(`📌 Resuming session: ${flags.resume} (${metadata?.messageCount ?? 0} messages)\n`)
      return flags.resume
    }

    if (flags.continue) {
      // Continue most recent session
      const mostRecentSessionId = await this.getMostRecentSessionId(agent)

      if (!mostRecentSessionId) {
        exitWithCode(ExitCode.VALIDATION_ERROR, 'No previous sessions found. Start a new conversation without -c flag.')
      }

      const metadata = await agent.getSessionMetadata(mostRecentSessionId)
      this.log(`📌 Continuing most recent session: ${mostRecentSessionId} (${metadata?.messageCount ?? 0} messages)\n`)
      return mostRecentSessionId
    }

    // No continuation flags: generate new unique session ID
    const newSessionId = this.generateSessionId()
    this.log(`🆕 Starting new session: ${newSessionId}\n`)
    return newSessionId
  }


  /**
   * Setup event listeners based on mode
   *
   * @param agent - CipherAgent instance
   * @param isInteractive - Whether in interactive mode
   */
  private setupEventListeners(
    agent: import('../../infra/cipher/cipher-agent.js').CipherAgent,
    isInteractive: boolean,
  ): void {
    if (!agent.agentEventBus) {
      throw new Error('Agent event bus not initialized')
    }

    const eventBus = agent.agentEventBus

    if (isInteractive) {
      // In interactive mode, show concise tool events for transparency
      eventBus.on('llmservice:toolCall', (payload) => {
        const details = this.formatToolForInteractive(payload.toolName, payload.args)
        displayInfo(`🔧 [Tool] ${payload.toolName}: ${details}`)
      })

      eventBus.on('llmservice:toolResult', (payload) => {
        if (payload.success) {
          displayInfo(`✓ [Done] ${payload.toolName}`)
        } else {
          displayInfo(`✗ [Error] ${payload.toolName}: ${payload.error}`)
        }
      })

      eventBus.on('llmservice:error', (payload) => {
        displayInfo(`Error: ${payload.error}`)
      })

      eventBus.on('cipher:conversationReset', () => {
        displayInfo('Conversation history cleared')
      })

      return
    }

    // In non-interactive mode, show verbose event logs for debugging
    eventBus.on('llmservice:thinking', () => {
      this.log('🤔 [Event] LLM is thinking...')
    })

    eventBus.on('llmservice:response', (payload) => {
      this.log(`✅ [Event] LLM Response (${payload.provider}/${payload.model})`)
    })

    eventBus.on('llmservice:toolCall', (payload) => {
      const formattedCall = formatToolCall(payload.toolName, payload.args)
      this.log(`🔧 [Event] Tool Call: ${formattedCall}`)
    })

    eventBus.on('llmservice:toolResult', (payload) => {
      const resultSummary = formatToolResult(payload.toolName, payload.success, payload.result, payload.error)

      if (payload.success) {
        this.log(`✓ [Event] Tool Success: ${payload.toolName} → ${resultSummary}`)
      } else {
        this.log(`✗ [Event] Tool Error: ${payload.toolName} → ${resultSummary}`)
      }
    })

    eventBus.on('llmservice:error', (payload) => {
      this.log(`❌ [Event] LLM Error: ${payload.error}`)
    })

    eventBus.on('cipher:conversationReset', () => {
      this.log('🔄 [Event] Conversation Reset')
    })
  }

}
