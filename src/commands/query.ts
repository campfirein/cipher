import {Args, Command, Flags} from '@oclif/core'
import {randomUUID} from 'node:crypto'

import type {IProjectConfigStore} from '../core/interfaces/i-project-config-store.js'
import type {ITrackingService} from '../core/interfaces/i-tracking-service.js'

import {getCurrentConfig, isDevelopment} from '../config/environment.js'
import {PROJECT} from '../constants.js'
import {CipherAgent} from '../infra/cipher/cipher-agent.js'
import {ExitCode, ExitError, exitWithCode} from '../infra/cipher/exit-codes.js'
import {getAgentStorage, getAgentStorageSync} from '../infra/cipher/storage/agent-storage.js'
import {WorkspaceNotInitializedError} from '../infra/cipher/validation/workspace-validator.js'
import {ProjectConfigStore} from '../infra/config/file-config-store.js'
import {KeychainTokenStore} from '../infra/storage/keychain-token-store.js'
import {MixpanelTrackingService} from '../infra/tracking/mixpanel-tracking-service.js'
import {formatError} from '../utils/error-handler.js'
import {formatToolCall, formatToolResult} from '../utils/tool-display-formatter.js'

export default class Query extends Command {
  public static args = {
    query: Args.string({
      description: 'Natural language question about your codebase or project knowledge',
      required: true,
    }),
  }
  public static description = `Query and retrieve information from the context tree
Good:
- "How is user authentication implemented?"
- "What are the API rate limits and where are they enforced?"
Bad:
- "auth" or "authentication" (too vague, not a question)
- "show me code" (not specific about what information is needed)`
  public static examples = [
    '# Ask questions about patterns, decisions, or implementation details',
    '<%= config.bin %> <%= command.id %> What are the coding standards?',
    '<%= config.bin %> <%= command.id %> How is authentication implemented?',
    '',
    ...(isDevelopment()
      ? [
          '# Query with OpenRouter (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY Show me all API endpoints',
          '',
          '# Query with custom model (development only)',
          '<%= config.bin %> <%= command.id %> -k YOUR_API_KEY -m anthropic/claude-sonnet-4 Explain the database schema',
          '',
          '# Query with verbose output (development only)',
          '<%= config.bin %> <%= command.id %> -v What testing strategies are used?',
        ]
      : []),
  ]
  public static flags = {
    ...(isDevelopment()
      ? {
          apiKey: Flags.string({
            char: 'k',
            description: 'OpenRouter API key (use OpenRouter instead of internal gRPC backend) [Development only]',
            env: 'OPENROUTER_API_KEY',
          }),
          model: Flags.string({
            char: 'm',
            description:
              'Model to use (default: google/gemini-2.5-pro for OpenRouter, gemini-2.5-pro for gRPC) [Development only]',
          }),
          verbose: Flags.boolean({
            char: 'v',
            default: false,
            description: 'Enable verbose debug output [Development only]',
          }),
        }
      : {}),
  }
  public static strict = false

  // Override catch to prevent oclif from logging errors that were already displayed
  public async catch(error: Error & {oclif?: {exit: number}}): Promise<void> {
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
    trackingService: ITrackingService
  } {
    return {
      projectConfigStore: new ProjectConfigStore(),
      trackingService: new MixpanelTrackingService(new KeychainTokenStore()),
    }
  }

  /**
   * Generate a unique session ID for the query agent.
   * Uses crypto.randomUUID() for guaranteed uniqueness (122 bits of entropy).
   */
  protected generateSessionId(): string {
    return randomUUID()
  }

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(Query)

    const {projectConfigStore, trackingService} = this.createServices()

    // Initialize storage for tool call tracking (auto-detects .brv/blobs)
    const storage = await getAgentStorage()
    let executionId: null | string = null

    try {
      // Get authentication token
      const tokenStore = new KeychainTokenStore()
      const token = await tokenStore.load()
      if (!token) {
        exitWithCode(ExitCode.CONFIG_ERROR, 'Authentication required. Please run "brv login" first.')
      }

      // Load project config
      const brvConfig = await projectConfigStore.read()

      // Validate workspace is initialized
      if (!brvConfig) {
        throw new WorkspaceNotInitializedError(
          'Project not initialized. Please run "brv init" to select your team and workspace.',
          '.brv',
        )
      }

      // Combine all query terms from argv (everything after flags)
      const queryTerms = argv.join(' ')

      // Create execution with status='running' (query runs synchronously)
      executionId = storage.createExecution('query', queryTerms)

      // Create LLM config
      const model = flags.model ?? (flags.apiKey ? 'google/gemini-2.5-pro' : 'gemini-2.5-pro')
      const envConfig = getCurrentConfig()

      const llmConfig = {
        accessToken: token.accessToken,
        apiBaseUrl: envConfig.llmApiBaseUrl,
        fileSystemConfig: {workingDirectory: process.cwd()},
        maxIterations: 5,
        maxTokens: 2048,
        model,
        openRouterApiKey: flags.apiKey,
        projectId: PROJECT,
        sessionKey: token.sessionKey,
        temperature: 0.7,
        topK: 10,
        topP: 0.95,
        verbose: flags.verbose ?? false,
      }

      // Create and start CipherAgent
      const agent = new CipherAgent(llmConfig, brvConfig)

      this.log('Querying context tree...')
      await agent.start()

      try {
        const sessionId = this.generateSessionId()

        // Setup event listeners (display + tool call tracking)
        this.setupEventListeners(agent, flags.verbose ?? false)
        this.setupToolCallTracking(agent, executionId)

        // Execute with autonomous mode and query commandType
        const prompt = `Search the context tree for: ${queryTerms}`
        const response = await agent.execute(prompt, sessionId, {
          executionContext: {commandType: 'query'},
          mode: 'autonomous',
        })

        // Mark execution as completed
        storage.updateExecutionStatus(executionId, 'completed', response)

        this.log('\nQuery Results:')
        this.log(response)

        // Track query
        await trackingService.track('mem:query')
      } finally {
        // Cleanup old executions
        storage.cleanupOldExecutions(100)
      }
    } catch (error) {
      // Mark execution as failed
      if (executionId) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        storage.updateExecutionStatus(executionId, 'failed', undefined, errorMessage)
      }

      if (error instanceof WorkspaceNotInitializedError) {
        this.handleWorkspaceError(error)
        return
      }

      // Display context on one line, error on separate line
      process.stderr.write('Failed to query context tree:\n')
      exitWithCode(ExitCode.RUNTIME_ERROR, formatError(error))
    }
  }

  /**
   * Create result summary for tool call
   */
  private createResultSummary(result: string): string {
    const lines = result.split('\n').length
    const chars = result.length
    return `${lines} lines, ${chars} chars`
  }

  /**
   * Format items count from list_directory result
   */
  private formatItemsCount(result: unknown): string {
    if (typeof result === 'string') {
      const lines = result.split('\n').filter((line) => line.trim())
      return `${lines.length} items`
    }

    if (Array.isArray(result)) {
      return `${result.length} items`
    }

    return ''
  }

  /**
   * Format matches count from grep_content result
   */
  private formatMatchesCount(result: unknown): string {
    if (typeof result === 'string') {
      const lines = result.split('\n').filter((line) => line.trim())
      return `${lines.length} matches found`
    }

    if (Array.isArray(result)) {
      return `${result.length} matches found`
    }

    return ''
  }

  /**
   * Format tool result summary for display
   */
  private formatToolResultSummary(toolName: string, result: unknown): string {
    try {
      switch (toolName) {
        case 'bash_exec':
        case 'create_knowledge_topic':
        case 'delete_knowledge_topic':
        case 'detect_domains':
        case 'read_file':
        case 'update_knowledge_topic':
        case 'write_file': {
          return ''
        }

        case 'find_knowledge_topics': {
          return this.formatTopicsCount(result)
        }

        case 'grep_content': {
          return this.formatMatchesCount(result)
        }

        case 'list_directory': {
          return this.formatItemsCount(result)
        }

        default: {
          return ''
        }
      }
    } catch {
      return ''
    }
  }

  /**
   * Format topics count from find_knowledge_topics result
   */
  private formatTopicsCount(result: unknown): string {
    if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result)
        const count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length
        return `${count} topics retrieved`
      } catch {
        return ''
      }
    }

    if (typeof result === 'object' && result !== null) {
      const resultObj = result as {results?: unknown[]; total?: number}
      if (Array.isArray(resultObj.results)) {
        return `${resultObj.results.length} topics retrieved`
      }

      if (typeof resultObj.total === 'number') {
        return `${resultObj.total} topics retrieved`
      }

      if (Array.isArray(result)) {
        return `${result.length} topics retrieved`
      }
    }

    return ''
  }

  /**
   * Get user-friendly description for a tool
   *
   * @param toolName - Name of the tool
   * @param args - Tool arguments
   * @returns User-friendly description
   */
  private getToolDescription(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'bash_exec': {
        const cmd = String(args.command ?? '')
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
        return 'Processing...'
      }
    }
  }

  /**
   * Handle workspace not initialized error
   */
  private handleWorkspaceError(_error: WorkspaceNotInitializedError): void {
    const message = 'Project not initialized. Please run "brv init" to select your team and workspace.'

    exitWithCode(ExitCode.VALIDATION_ERROR, message)
  }

  /**
   * Setup event listeners for CipherAgent
   */
  private setupEventListeners(agent: CipherAgent, verbose: boolean): void {
    if (!agent.agentEventBus) {
      throw new Error('Agent event bus not initialized')
    }

    const eventBus = agent.agentEventBus

    if (verbose) {
      // Verbose mode: show detailed events
      eventBus.on('llmservice:thinking', () => {
        this.log('🤔 [Event] LLM is thinking...')
      })

      eventBus.on('llmservice:response', (payload) => {
        this.log(`✅ [Event] LLM Response (${payload.provider}/${payload.model})`)
      })

      eventBus.on('llmservice:toolCall', (payload) => {
        // Clear any spinner on current line before printing (use spaces instead of ANSI codes)

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

      // NOTE: llmservice:error is handled by catch block in the run method
      // which displays error via this.error(). DO NOT display here to avoid duplicate.
    } else {
      // Non-verbose mode: show concise tool progress with descriptions
      eventBus.on('llmservice:toolCall', (payload) => {
        // Clear any spinner on current line before printing (use spaces instead of ANSI codes)

        const description = this.getToolDescription(payload.toolName, payload.args)
        this.log(`🔧 ${payload.toolName} → ${description}`)
      })

      eventBus.on('llmservice:toolResult', (payload) => {
        if (payload.success) {
          // Show brief success summary for tool completion
          const summary = this.formatToolResultSummary(payload.toolName, payload.result)
          const completionText = summary ? `Complete (${summary})` : 'Complete'
          this.log(`✅ ${payload.toolName} → ${completionText}`)
        } else {
          this.log(`✗ ${payload.toolName} → Failed: ${payload.error}`)
        }
      })

      // NOTE: llmservice:error is handled by catch block in the run method
      // which displays error via this.error(). DO NOT display here to avoid duplicate.
    }
  }

  /**
   * Setup tool call tracking to persist in database
   */
  private setupToolCallTracking(agent: CipherAgent, executionId: string): void {
    if (!agent.agentEventBus) {
      return
    }

    const storage = getAgentStorageSync()
    const eventBus = agent.agentEventBus
    const toolCallMap = new Map<string, string>() // callId -> dbToolCallId

    eventBus.on('llmservice:toolCall', (payload) => {
      try {
        if (!payload.callId) return
        const toolCallId = storage.addToolCall(executionId, {
          args: payload.args,
          name: payload.toolName,
        })
        toolCallMap.set(payload.callId, toolCallId)
      } catch {
        // Ignore errors - don't break query execution
      }
    })

    eventBus.on('llmservice:toolResult', (payload) => {
      try {
        if (!payload.callId) return
        const toolCallId = toolCallMap.get(payload.callId)
        if (toolCallId) {
          const result = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result)
          storage.updateToolCall(toolCallId, payload.success ? 'completed' : 'failed', {
            error: payload.error,
            result,
            resultSummary: this.createResultSummary(result),
          })
        }
      } catch {
        // Ignore errors - don't break query execution
      }
    })
  }
}
