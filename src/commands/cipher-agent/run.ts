import {Args, Command, Flags} from '@oclif/core'

import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'

import {getCurrentConfig} from '../../config/environment.js'
import {PROJECT} from '../../constants.js'
import {CipherAgent} from '../../infra/cipher/cipher-agent.js'
import {ExitCode, ExitError, exitWithCode} from '../../infra/cipher/exit-codes.js'
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
      description: 'Model to use (default: google/gemini-2.5-pro for OpenRouter, gemini-2.5-pro for gRPC)',
    }),
    resume: Flags.string({
      char: 'r',
      description: 'Resume specific session by ID (requires prompt in headless mode)',
    }),
    temperature: Flags.string({
      char: 'T',
      description: 'Temperature for randomness 0-1 (default: 0.2)',
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

  // Override catch to prevent oclif from logging errors that were already displayed
  async catch(error: Error & {oclif?: {exit: number}}): Promise<void> {
    // Check if error is ExitError (message already displayed by exitWithCode)
    if (error instanceof ExitError) {
      return
    }

    // Backwards compatibility: also check oclif.exit property
    if (error.oclif?.exit !== undefined) {
      // Error already displayed by exitWithCode, silently exit
      return
    }

    // For other errors, re-throw to let oclif handle them
    throw error
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
  protected async getMostRecentSessionId(
    agent: import('../../infra/cipher/cipher-agent.js').CipherAgent,
  ): Promise<string | undefined> {
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

  // eslint-disable-next-line complexity
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
      const currentPrompt: string = args.prompt || '' // Will be handled by interactive mode if empty

      // Determine interactive mode
      // Priority: explicit flag > TTY detection
      const isInteractive: boolean =
        flags.interactive === undefined
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

      // Validate workspace is initialized
      if (!brvConfig) {
        throw new WorkspaceNotInitializedError(
          'Project not initialized. Please run "brv init" to select your team and workspace.',
          '.brv',
        )
      }

      // Create LLM configuration
      const llmConfig = this.createLLMConfig(
        {...token, spaceId: brvConfig?.spaceId ?? '', teamId: brvConfig?.teamId ?? ''},
        flags,
      )

      // Create CipherAgent with service factory pattern
      const agent = new CipherAgent(llmConfig, brvConfig)

      this.log('Starting CipherAgent...')
      await agent.start()

      try {
        // Resolve session ID based on flags
        const resolvedSessionId = await this.resolveSessionId(agent, flags)

        // Setup event listeners
        this.setupEventListeners(agent, isInteractive)

        if (isInteractive) {
          // Interactive mode: start the loop with event bus for spinner
          await startInteractiveLoop(agent, {
            eventBus: agent.agentEventBus,
            model: llmConfig.model,
            sessionId: resolvedSessionId,
          })
        } else {
          // Non-interactive mode: single execution
          if (!currentPrompt) {
            this.error('Prompt is required in non-interactive mode.')
          }

          this.log('Executing prompt...')
          const response = await agent.execute(currentPrompt, resolvedSessionId)

          this.log('\nCipherAgent Response:')
          this.log(response)

          // Show agent state
          const state = agent.getState()
          this.log(`\n[Agent State: ${state.currentIteration} iterations]`)
        }
      } finally {
        // await agent.stop()
      }
    } catch (error) {
      // Handle workspace not initialized error with friendly message
      if (error instanceof WorkspaceNotInitializedError) {
        this.handleWorkspaceError(error)
        return
      }

      // Handle graceful exit (Ctrl+C) - exit silently without error
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes('Readline closed')) {
        // Silent exit - cleanup already happened
        return
      }

      // Generic error handling with proper exit code
      exitWithCode(ExitCode.RUNTIME_ERROR, `Failed to execute CipherAgent: ${errorMessage}`)
    }
  }

  /**
   * Validate that a session exists in storage.
   *
   * @param agent - CipherAgent instance
   * @param sessionId - Session ID to validate
   * @returns True if session exists
   */
  protected async validateSessionExists(
    agent: import('../../infra/cipher/cipher-agent.js').CipherAgent,
    sessionId: string,
  ): Promise<boolean> {
    const metadata = await agent.getSessionMetadata(sessionId)
    return metadata !== undefined
  }

  /**
   * Create LLM configuration from flags and environment
   *
   * @param token - Authentication token
   * @param token.accessToken - Access token for authentication
   * @param token.sessionKey - Session key for authentication
   * @param token.spaceId - Space ID for the session
   * @param token.teamId - Team ID for the session
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
    token: {accessToken: string; sessionKey: string; spaceId: string; teamId: string},
    flags: {
      apiKey?: string
      maxTokens?: number
      model?: string
      temperature?: string
      verbose?: boolean
      workingDirectory?: string
    },
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
    spaceId: string
    teamId: string
    temperature: number
    verbose?: boolean
  } {
    // Default model: google/gemini-2.5-pro for OpenRouter, gemini-2.5-pro for gRPC
    const model = flags.model ?? (flags.apiKey ? 'google/gemini-2.5-pro' : 'gemini-2.5-pro')
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
      spaceId: token.spaceId,
      teamId: token.teamId,
      temperature: flags.temperature ? Number.parseFloat(flags.temperature) : 0.2, // Default: 0.2
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
    // Provide user-friendly action descriptions
    switch (toolName) {
      case 'bash_exec': {
        const cmd = String(args.command ?? '')
        // Truncate long commands but keep readable
        return cmd.length > 60 ? `Running command...` : `Running: ${cmd}`
      }

      case 'create_knowledge_topic': {
        return 'Creating knowledge topic...'
      }

      case 'find_knowledge_topics': {
        return 'Querying knowledge base...'
      }

      case 'grep_content': {
        return 'Searching context tree...'
      }

      case 'list_directory': {
        return 'Listing directory...'
      }

      case 'read_file': {
        return `Reading file...`
      }

      case 'update_knowledge_topic': {
        return 'Updating knowledge topic...'
      }

      case 'write_file': {
        return 'Writing file...'
      }

      default: {
        // For other tools, use a generic format
        return 'Processing...'
      }
    }
  }

  /**
   * Format tool result summary for display
   *
   * @param toolName - Name of the tool
   * @param result - Tool result data
   * @returns Formatted summary string or empty if no summary needed
   */
  private formatToolResultSummary(toolName: string, result: unknown): string {
    try {
      switch (toolName) {
        case 'find_knowledge_topics': {
          // Parse result to count topics
          if (typeof result === 'string') {
            try {
              const parsed = JSON.parse(result)
              const count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length
              return `${count} topics retrieved`
            } catch {
              return ''
            }
          }

          return ''
        }

        case 'grep_content': {
          // Parse result to count matches
          if (typeof result === 'string') {
            const lines = result.split('\n').filter((line) => line.trim())
            return `${lines.length} matches found`
          }

          return ''
        }

        case 'list_directory': {
          // Parse result to count items
          if (typeof result === 'string') {
            const lines = result.split('\n').filter((line) => line.trim())
            return `${lines.length} items`
          }

          return ''
        }

        default: {
          return ''
        }
      }
    } catch {
      // If parsing fails, just return empty
      return ''
    }
  }

  /**
   * Handle workspace not initialized error with friendly message
   *
   * @param _error - WorkspaceNotInitializedError instance (unused, kept for type safety)
   */
  private handleWorkspaceError(_error: WorkspaceNotInitializedError): void {
    const message = 'Project not initialized. Please run "brv init" to select your team and workspace.'

    exitWithCode(ExitCode.VALIDATION_ERROR, message)
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
      exitWithCode(
        ExitCode.VALIDATION_ERROR,
        'Cannot use both -c/--continue and -r/--resume flags together. Choose one.',
      )
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
    this.log(`🚀 Starting new session: ${newSessionId}\n`)
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
        // Clean format: 🔧 tool_name → Action description...
        displayInfo(`🔧 ${payload.toolName} → ${details}`)
      })

      eventBus.on('llmservice:toolResult', (payload) => {
        if (payload.success) {
          // Clean format: ✅ tool_name → Complete (with optional summary)
          const summary = this.formatToolResultSummary(payload.toolName, payload.result)
          displayInfo(summary ? `✅ ${payload.toolName} → Complete (${summary})` : `✅ ${payload.toolName} → Complete`)
        } else {
          // Clean format: ❌ tool_name → Failed: error message
          const errorMessage = payload.error || 'Unknown error'
          displayInfo(`❌ ${payload.toolName} → Failed: ${errorMessage}`)
        }
      })

      eventBus.on('llmservice:error', (payload) => {
        const errorMessage = payload.error || 'Unknown error occurred'
        displayInfo(`❌ Error: ${errorMessage}`)
      })

      eventBus.on('cipher:conversationReset', () => {
        displayInfo('🔄 Conversation history cleared')
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
      const errorMessage = payload.error || 'Unknown error occurred'
      this.log(`❌ [Event] LLM Error: ${errorMessage}`)
    })

    eventBus.on('cipher:conversationReset', () => {
      this.log('🔄 [Event] Conversation Reset')
    })
  }
}
