import {randomUUID} from 'node:crypto'

import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {IProjectConfigStore} from '../../core/interfaces/i-project-config-store.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITokenStore} from '../../core/interfaces/i-token-store.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import type {IQueryUseCase, QueryUseCaseRunOptions} from '../../core/interfaces/usecase/i-query-use-case.js'

import {getCurrentConfig} from '../../config/environment.js'
import {PROJECT} from '../../constants.js'
import {formatError} from '../../utils/error-handler.js'
import {formatToolCall, formatToolResult} from '../../utils/tool-display-formatter.js'
import {CipherAgent} from '../cipher/agent/index.js'
import {getAgentStorage, getAgentStorageSync} from '../cipher/storage/agent-storage.js'
import {WorkspaceNotInitializedError} from '../cipher/validation/workspace-validator.js'

export interface QueryUseCaseOptions {
  projectConfigStore: IProjectConfigStore
  terminal: ITerminal
  tokenStore: ITokenStore
  trackingService: ITrackingService
}

export class QueryUseCase implements IQueryUseCase {
  private readonly projectConfigStore: IProjectConfigStore
  private readonly terminal: ITerminal
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService

  constructor(options: QueryUseCaseOptions) {
    this.projectConfigStore = options.projectConfigStore
    this.terminal = options.terminal
    this.tokenStore = options.tokenStore
    this.trackingService = options.trackingService
  }

  /**
   * Create CipherAgent instance. Protected to allow test overrides.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected createCipherAgent(llmConfig: any, brvConfig: BrvConfig): CipherAgent {
    return new CipherAgent(llmConfig, brvConfig)
  }

  /**
   * Generate a unique session ID for the query agent.
   * Uses crypto.randomUUID() for guaranteed uniqueness (122 bits of entropy).
   */
  protected generateSessionId(): string {
    return randomUUID()
  }

  public async run(options: QueryUseCaseRunOptions): Promise<void> {
    // Initialize storage for tool call tracking (auto-detects .brv/blobs)
    const storage = await getAgentStorage()
    let executionId: null | string = null

    try {
      // Get authentication token
      const token = await this.tokenStore.load()
      if (!token) {
        this.terminal.log('Authentication required. Please run "brv login" first.')
        return
      }

      // Load project config
      const brvConfig = await this.projectConfigStore.read()

      // Validate workspace is initialized
      if (!brvConfig) {
        throw new WorkspaceNotInitializedError(
          'Project not initialized. Please run "brv init" to select your team and workspace.',
          '.brv',
        )
      }

      // Create execution with status='running' (query runs synchronously)
      executionId = storage.createExecution('query', options.query)

      // Create LLM config
      const model = options.model ?? (options.apiKey ? 'google/gemini-2.5-pro' : 'gemini-2.5-pro')
      const envConfig = getCurrentConfig()

      const llmConfig = {
        accessToken: token.accessToken,
        apiBaseUrl: envConfig.llmApiBaseUrl,
        fileSystemConfig: {workingDirectory: process.cwd()},
        maxIterations: 5,
        maxTokens: 2048,
        model,
        openRouterApiKey: options.apiKey,
        projectId: PROJECT,
        sessionKey: token.sessionKey,
        temperature: 0.7,
        topK: 10,
        topP: 0.95,
        verbose: options.verbose ?? false,
      }

      // Create and start CipherAgent
      const agent = this.createCipherAgent(llmConfig, brvConfig)

      this.terminal.log('Querying context tree...')
      await agent.start()

      try {
        const sessionId = this.generateSessionId()

        // Setup event listeners (display + tool call tracking)
        this.setupEventListeners(agent, options.verbose ?? false)
        this.setupToolCallTracking(agent, executionId)

        // Execute with query commandType
        const prompt = `Search the context tree for: ${options.query}`
        const response = await agent.execute(prompt, sessionId, {
          executionContext: {commandType: 'query'},
        })

        // Mark execution as completed
        storage.updateExecutionStatus(executionId, 'completed', response)

        this.terminal.log('\nQuery Results:')
        this.terminal.log(response)

        // Track query
        await this.trackingService.track('mem:query')
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
      this.terminal.log(formatError(error))
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
   * Extract summary from curate tool result
   */
  private extractCurateSummary(
    result: unknown,
  ): null | {added?: number; deleted?: number; failed?: number; merged?: number; updated?: number} {
    if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result) as {
          applied?: unknown[]
          summary?: {added?: number; deleted?: number; failed?: number; merged?: number; updated?: number}
        }
        return parsed.summary ?? null
      } catch {
        return null
      }
    }

    if (typeof result === 'object' && result !== null) {
      const resultObj = result as {
        applied?: unknown[]
        summary?: {added?: number; deleted?: number; failed?: number; merged?: number; updated?: number}
      }
      return resultObj.summary ?? null
    }

    return null
  }

  /**
   * Format curate tool operation summary
   */
  private formatCurateResult(result: unknown): string {
    const summary = this.extractCurateSummary(result)
    if (!summary) {
      return ''
    }

    const {added = 0, deleted = 0, failed = 0, merged = 0, updated = 0} = summary
    const parts: string[] = []
    if (added > 0) parts.push(`${added} added`)
    if (updated > 0) parts.push(`${updated} updated`)
    if (merged > 0) parts.push(`${merged} merged`)
    if (deleted > 0) parts.push(`${deleted} deleted`)
    if (failed > 0) parts.push(`${failed} failed`)
    return parts.length > 0 ? parts.join(', ') : 'No operations'
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
        case 'write_file': {
          return ''
        }

        case 'curate': {
          return this.formatCurateResult(result)
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

      case 'curate': {
        return 'Curating context tree...'
      }

      case 'find_knowledge_topics': {
        return 'Querying context tree...'
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

    this.terminal.log(message)
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
        this.terminal.log('🤔 [Event] LLM is thinking...')
      })

      eventBus.on('llmservice:response', (payload) => {
        this.terminal.log(`✅ [Event] LLM Response (${payload.provider}/${payload.model})`)
      })

      eventBus.on('llmservice:toolCall', (payload) => {
        // Clear any spinner on current line before printing (use spaces instead of ANSI codes)

        const formattedCall = formatToolCall(payload.toolName, payload.args)
        this.terminal.log(`🔧 [Event] Tool Call: ${formattedCall}`)
      })

      eventBus.on('llmservice:toolResult', (payload) => {
        const resultSummary = formatToolResult(payload.toolName, payload.success, payload.result, payload.error)

        if (payload.success) {
          this.terminal.log(`✓ [Event] Tool Success: ${payload.toolName} → ${resultSummary}`)
        } else {
          this.terminal.log(`✗ [Event] Tool Error: ${payload.toolName} → ${resultSummary}`)
        }
      })

      // NOTE: llmservice:error is handled by catch block in the run method
      // which displays error via this.error(). DO NOT display here to avoid duplicate.
    } else {
      // Non-verbose mode: show concise tool progress with descriptions
      // eventBus.on('llmservice:toolCall', (payload) => {
      //   // Clear any spinner on current line before printing (use spaces instead of ANSI codes)
      //   const description = this.getToolDescription(payload.toolName, payload.args)
      //   this.terminal.log(`🔧 ${payload.toolName} → ${description}`)
      // })
      // eventBus.on('llmservice:toolResult', (payload) => {
      //   if (payload.success) {
      //     // Show brief success summary for tool completion
      //     const summary = this.formatToolResultSummary(payload.toolName, payload.result)
      //     const completionText = summary ? `Complete (${summary})` : 'Complete'
      //     this.terminal.log(`✅ ${payload.toolName} → ${completionText}`)
      //   } else {
      //     this.terminal.log(`✗ ${payload.toolName} → Failed: ${payload.error}`)
      //   }
      // })
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
          // Format result: if error, wrap in {error: "..."} object
          let result: string
          if (payload.success) {
            result = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result)
          } else {
            const errorMsg = payload.error ?? (typeof payload.result === 'string' ? payload.result : 'Unknown error')
            result = JSON.stringify({error: errorMsg})
          }

          storage.updateToolCall(toolCallId, payload.success ? 'completed' : 'failed', {
            result,
            resultSummary: payload.success ? this.createResultSummary(result) : undefined,
          })
        }
      } catch {
        // Ignore errors - don't break query execution
      }
    })
  }
}
