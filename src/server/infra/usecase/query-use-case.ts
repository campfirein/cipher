import {
  ConnectionError,
  ConnectionFailedError,
  type ConnectionResult,
  connectToTransport,
  InstanceCrashedError,
  type ITransportClient,
  type LlmResponse,
  type LlmToolCall,
  type LlmToolResult,
  NoInstanceRunningError,
  type TaskAck,
  type TaskCompleted,
  type TaskError,
  type TaskStarted,
} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'

import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {ITerminal} from '../../core/interfaces/services/i-terminal.js'
import type {ITrackingService} from '../../core/interfaces/services/i-tracking-service.js'
import type {IQueryUseCase, QueryUseCaseRunOptions} from '../../core/interfaces/usecase/i-query-use-case.js'

import {CipherAgent} from '../../../agent/infra/agent/index.js'
import {formatError} from '../../utils/error-handler.js'
import {getSandboxEnvironmentName, isSandboxEnvironment, isSandboxNetworkError} from '../../utils/sandbox-detector.js'
import {InlineAgent} from '../process/inline-agent-executor.js'
import {HeadlessTerminal} from '../terminal/headless-terminal.js'

/** Type for transport connection function (for DI/testing) */
export type TransportConnector = (fromDir?: string) => Promise<ConnectionResult>

/**
 * Structured query result for JSON output.
 */
export interface QueryResult {
  error?: string
  result?: string
  status: 'completed' | 'error'
  toolCalls?: Array<{status: string; summary: string; tool: string}>
}

export interface QueryUseCaseOptions {
  terminal: ITerminal
  trackingService: ITrackingService
  /** Optional transport connector for dependency injection (defaults to connectToTransport) */
  transportConnector?: TransportConnector
}

export class QueryUseCase implements IQueryUseCase {
  private readonly terminal: ITerminal
  private readonly trackingService: ITrackingService
  private readonly transportConnector: TransportConnector

  constructor(options: QueryUseCaseOptions) {
    this.terminal = options.terminal
    this.trackingService = options.trackingService
    this.transportConnector = options.transportConnector ?? connectToTransport
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
    await this.trackingService.track('mem:query', {status: 'started'})
    const format = options.format ?? 'text'

    if (!options.query.trim()) {
      if (format === 'json') {
        this.outputJsonResult({error: 'Query argument is required', status: 'error'})
      } else {
        this.terminal.log('Query argument is required.')
        this.terminal.log('Usage: brv query "your question here"')
      }

      return
    }

    const verbose = options.verbose || false

    // Connect to running instance or create inline agent
    let client: ITransportClient | undefined

    try {
      if (options.headless) {
        const inlineAgent = await InlineAgent.create()
        client = inlineAgent.transportClient
      } else {
        if (verbose) {
          this.terminal.log('Discovering running instance...')
        }

        // Use modern connectToTransport API (auto-discovers and connects)
        const {client: connectedClient} = await this.transportConnector()
        client = connectedClient
      }

      if (verbose) {
        this.terminal.log(`Connected to instance (clientId: ${client.getClientId()})`)
      }

      // Generate taskId in UseCase (Application layer owns task creation)
      const taskId = randomUUID()

      // Send task:create request
      await client.requestWithAck<TaskAck>('task:create', {
        content: options.query,
        taskId,
        type: 'query',
      })
      // Note: response.taskId confirms what we sent (no longer extracting)

      if (verbose) {
        this.terminal.log(`Task created: ${taskId}`)
      }

      // Wait for task completion with streaming
      await this.streamTaskResults(client, taskId, verbose, format)
      await this.trackingService.track('mem:query', {status: 'finished'})
    } catch (error) {
      if (format === 'json') {
        this.handleConnectionErrorJson(error)
      } else {
        this.handleConnectionError(error)
      }

      await this.trackingService.track('mem:query', {message: formatError(error), status: 'error'})
    } finally {
      // Cleanup
      if (client) {
        await client.disconnect()
      }
    }
  }

  /**
   * Format a parsed object result into a concise summary.
   */
  private formatParsedResult(obj: Record<string, unknown>): string {
    // Check for common patterns
    if ('topics' in obj && Array.isArray(obj.topics)) {
      return `${(obj.topics as unknown[]).length} topics found`
    }

    if ('results' in obj && Array.isArray(obj.results)) {
      return `${(obj.results as unknown[]).length} matches`
    }

    if ('matches' in obj && Array.isArray(obj.matches)) {
      return `${(obj.matches as unknown[]).length} matches`
    }

    if ('filesSearched' in obj) {
      const files = obj.filesSearched as number
      const matches = Array.isArray(obj.matches) ? obj.matches.length : 0
      return `${files} files searched, ${matches} matches`
    }

    // glob_files returns {files: [...]}
    if ('files' in obj && Array.isArray(obj.files)) {
      return `${(obj.files as unknown[]).length} files`
    }

    // list_directory returns {entries: [...]}
    if ('entries' in obj && Array.isArray(obj.entries)) {
      return `${(obj.entries as unknown[]).length} entries`
    }

    // read_file returns {content: string, ...}
    if ('content' in obj && typeof obj.content === 'string') {
      const content = obj.content as string
      const lines = content.split('\n').length
      return `${lines} lines`
    }

    if ('count' in obj) {
      return `${obj.count} items`
    }

    // Check for any array property as fallback
    for (const key of Object.keys(obj)) {
      if (Array.isArray(obj[key])) {
        return `${(obj[key] as unknown[]).length} ${key}`
      }
    }

    // Generic object - just show it worked
    return 'Done'
  }

  /**
   * Format tool arguments for display.
   * Extract the most meaningful value for human reading.
   */
  private formatToolArgs(toolName: string, args: Record<string, unknown>): string {
    // Extract the most meaningful arg based on tool type
    // Tool names use snake_case (LLM convention)
    /* eslint-disable camelcase */
    const meaningfulKeys: Record<string, string[]> = {
      curate: ['operations'],
      find_knowledge_topics: ['topicPattern', 'query'],
      glob_files: ['pattern', 'glob'],
      grep_content: ['pattern', 'query'],
      list_directory: ['path', 'directory'],
      read_file: ['filePath', 'path'],
      read_knowledge_topic: ['topicPath', 'path'],
    }
    /* eslint-enable camelcase */

    const keys = meaningfulKeys[toolName] ?? Object.keys(args)
    for (const key of keys) {
      if (args[key] !== undefined) {
        const value = args[key]
        if (typeof value === 'string') {
          // Clean display - just the value, truncated if needed
          return value.length > 40 ? `${value.slice(0, 37)}...` : value
        }

        if (Array.isArray(value)) {
          return `${value.length} items`
        }
      }
    }

    return ''
  }

  /**
   * Format tool result for display.
   * Shows meaningful, concise summary - NEVER shows raw JSON.
   */
  private formatToolResult(payload: LlmToolResult): string {
    if (!payload.success) {
      const errMsg = payload.error ?? 'Failed'
      return errMsg.length > 50 ? `${errMsg.slice(0, 47)}...` : errMsg
    }

    if (!payload.result) return 'Done'

    // Handle different result types with concise output
    if (Array.isArray(payload.result)) {
      return `${payload.result.length} results`
    }

    // Handle string results - might be JSON
    if (typeof payload.result === 'string') {
      // Try to parse as JSON for better formatting
      try {
        const parsed = JSON.parse(payload.result)
        return this.formatParsedResult(parsed)
      } catch {
        // Not JSON - show char count for long strings
        if (payload.result.length > 100) {
          return `${payload.result.length} chars`
        }

        return payload.result.length > 40 ? `${payload.result.slice(0, 37)}...` : payload.result
      }
    }

    if (typeof payload.result === 'object') {
      return this.formatParsedResult(payload.result as Record<string, unknown>)
    }

    return 'Done'
  }

  /**
   * Handle connection-related errors with user-friendly messages.
   */
  private handleConnectionError(error: unknown): void {
    if (error instanceof NoInstanceRunningError) {
      // Check if running in sandbox environment
      if (isSandboxEnvironment()) {
        const sandboxName = getSandboxEnvironmentName()
        this.terminal.log(
          `Error: No ByteRover instance is running.\n` +
            `⚠️  Sandbox environment detected (${sandboxName}).\n\n` +
            `Please run 'brv' command in a separate terminal window/tab outside the sandbox first.`,
        )
      } else {
        this.terminal.log(
          'No ByteRover instance is running.\n\n' +
            'Start a ByteRover instance by running "brv" in a separate terminal window/tab.\n' +
            'The instance will keep running and handle your commands.',
        )
      }

      return
    }

    if (error instanceof InstanceCrashedError) {
      this.terminal.log('ByteRover instance has crashed.\n\nPlease restart with: brv')
      return
    }

    if (error instanceof ConnectionFailedError) {
      // Check if it's specifically a sandbox network restriction error
      const isSandboxError = isSandboxNetworkError(error.originalError ?? error)

      if (isSandboxError) {
        const sandboxName = getSandboxEnvironmentName()
        this.terminal.log(
          `Error: Failed to connect to ByteRover instance.\n` +
            `Port: ${error.port ?? 'unknown'}\n` +
            `⚠️  Sandbox network restriction detected (${sandboxName}).\n\n` +
            `Please allow network access in the sandbox and retry the command.`,
        )
      } else {
        this.terminal.log(`Failed to connect to ByteRover instance: ${error.message}`)
      }

      return
    }

    if (error instanceof ConnectionError) {
      this.terminal.log(`Connection error: ${error.message}`)
      return
    }

    // Unknown error
    const message = error instanceof Error ? error.message : String(error)
    this.terminal.log(`Unexpected error: ${message}`)
  }

  /**
   * Handle connection errors with JSON output.
   */
  private handleConnectionErrorJson(error: unknown): void {
    let errorMessage = 'An unexpected error occurred'

    if (error instanceof NoInstanceRunningError) {
      errorMessage = 'No ByteRover instance is running. Start one with: brv'
    } else if (error instanceof InstanceCrashedError) {
      errorMessage = 'ByteRover instance has crashed. Please restart with: brv'
    } else if (error instanceof ConnectionFailedError) {
      errorMessage = `Failed to connect to ByteRover instance: ${error.message}`
    } else if (error instanceof ConnectionError) {
      errorMessage = `Connection error: ${error.message}`
    } else if (error instanceof Error) {
      errorMessage = error.message
    }

    this.outputJsonResult({error: errorMessage, status: 'error'})
  }

  /**
   * Output JSON result for headless mode.
   */
  private outputJsonResult(result: QueryResult): void {
    const response = {
      command: 'query',
      data: result,
      success: result.status !== 'error',
      timestamp: new Date().toISOString(),
    }

    if (this.terminal instanceof HeadlessTerminal) {
      this.terminal.writeFinalResponse(response)
    } else {
      this.terminal.log(JSON.stringify(response))
    }
  }

  /**
   * Stream task results from the connected instance.
   */
  private async streamTaskResults(
    client: ITransportClient,
    taskId: string,
    verbose: boolean,
    format: 'json' | 'text' = 'text',
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let completed = false
      let resultPrinted = false // Track if we've already printed the result
      let finalResult: string | undefined
      const toolCalls: Array<{status: string; summary: string; tool: string}> = []

      // Timeout after 5 minutes
      const timeout = setTimeout(
        () => {
          if (!completed) {
            completed = true
            cleanup()
            if (format === 'json') {
              this.outputJsonResult({error: 'Task timed out after 5 minutes', status: 'error'})
              resolve()
            } else {
              reject(new Error('Task timed out after 5 minutes'))
            }
          }
        },
        5 * 60 * 1000,
      )

      // Setup all event handlers
      const unsubscribers = [
        // task:ack - immediate acknowledgment
        client.on<TaskAck>('task:ack', (payload) => {
          if (payload.taskId === taskId && verbose) {
            this.terminal.log('Task acknowledged by server')
          }
        }),

        // task:started - task is being processed
        client.on<TaskStarted>('task:started', (payload) => {
          if (payload.taskId === taskId && verbose) {
            this.terminal.log('Task started processing...')
          }
        }),

        // llmservice:response - final response from LLM (only print once)
        client.on<LlmResponse>('llmservice:response', (payload) => {
          if (payload.taskId === taskId && payload.content && !resultPrinted) {
            resultPrinted = true
            finalResult = payload.content

            if (format === 'text') {
              this.terminal.log('\nResult:')
              this.terminal.log(payload.content)
            }
          }
        }),

        // llmservice:toolCall - tool invocation (stop showing after response)
        client.on<LlmToolCall>('llmservice:toolCall', (payload) => {
          if (payload.taskId === taskId && !resultPrinted) {
            const detail = payload.args ? this.formatToolArgs(payload.toolName, payload.args) : ''
            const suffix = detail ? `: ${detail}` : ''
            if (format === 'text') {
              this.terminal.log(`🔧 ${payload.toolName}${suffix}`)
            }

            // Track tool call for JSON output
            toolCalls.push({status: 'started', summary: suffix, tool: payload.toolName})
          }
        }),

        // llmservice:toolResult - tool result with summary (stop showing after response)
        client.on<LlmToolResult>('llmservice:toolResult', (payload) => {
          if (payload.taskId === taskId && !resultPrinted) {
            const status = payload.success ? '✓' : '✗'
            const resultSummary = this.formatToolResult(payload)
            if (format === 'text') {
              this.terminal.log(`  ${status} ${resultSummary}`)
            }

            // Update last tool call with result
            const lastCall = toolCalls.at(-1)
            if (lastCall) {
              lastCall.status = payload.success ? 'success' : 'failed'
              lastCall.summary = resultSummary
            }
          }
        }),

        // task:completed - task finished (chunks already streamed, just resolve)
        client.on<TaskCompleted>('task:completed', (payload) => {
          if (payload.taskId === taskId && !completed) {
            completed = true
            cleanup()

            if (format === 'json') {
              this.outputJsonResult({
                result: finalResult,
                status: 'completed',
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              })
            } else {
              this.terminal.log('') // Final newline for clean output
            }

            resolve()
          }
        }),

        // task:error - task failed
        client.on<TaskError>('task:error', (payload) => {
          if (payload.taskId === taskId && !completed) {
            completed = true
            cleanup()

            if (format === 'json') {
              this.outputJsonResult({error: payload.error.message, status: 'error'})
              resolve()
            } else {
              reject(new Error(payload.error.message))
            }
          }
        }),

        // Clear timeout when done
        () => clearTimeout(timeout),
      ]

      const cleanup = (): void => {
        for (const unsub of unsubscribers) unsub()
      }
    })
  }
}
