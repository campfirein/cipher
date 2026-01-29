import {
  ConnectionError,
  ConnectionFailedError,
  type ConnectionResult,
  connectToTransport,
  InstanceCrashedError,
  NoInstanceRunningError,
} from '@campfirein/brv-transport-client'
import {randomUUID} from 'node:crypto'

import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'
import type {IQueryUseCase, QueryUseCaseRunOptions} from '../../core/interfaces/usecase/i-query-use-case.js'

import {CipherAgent} from '../../agent/infra/agent/index.js'
import {
  LlmResponseEvent,
  LlmToolCallEvent,
  LlmToolResultEvent,
  TaskAck,
  TaskCompletedEvent,
  TaskCreateResponse,
  TaskErrorEvent,
  TaskStartedEvent,
} from '../../core/domain/transport/schemas.js'
import {ITransportClient} from '../../core/interfaces/transport/i-transport-client.js'
import { formatError } from '../../utils/error-handler.js'
import {getSandboxEnvironmentName, isSandboxEnvironment, isSandboxNetworkError} from '../../utils/sandbox-detector.js'

/** Type for transport connection function (for DI/testing) */
export type TransportConnector = (fromDir?: string) => Promise<ConnectionResult>

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
    if (!options.query.trim()) {
      this.terminal.log('Query argument is required.')
      this.terminal.log('Usage: brv query "your question here"')
      return
    }

    const verbose = options.verbose || false

    // Connect to running instance
    let client: ITransportClient | undefined

    try {
      if (verbose) {
        this.terminal.log('Discovering running instance...')
      }

      // Use modern connectToTransport API (auto-discovers and connects)
      const {client: connectedClient} = await this.transportConnector()
      client = connectedClient

      if (verbose) {
        this.terminal.log(`Connected to instance (clientId: ${client.getClientId()})`)
      }

      // Generate taskId in UseCase (Application layer owns task creation)
      const taskId = randomUUID()

      // Send task:create request
      await client.requestWithAck<TaskCreateResponse>(
        'task:create',
        {
          content: options.query,
          taskId,
          type: 'query',
        },
      )
      // Note: response.taskId confirms what we sent (no longer extracting)

      if (verbose) {
        this.terminal.log(`Task created: ${taskId}`)
      }

      // Wait for task completion with streaming
      await this.streamTaskResults(client, taskId, verbose)
      await this.trackingService.track('mem:query', {status: 'finished'})
    } catch (error) {
      this.handleConnectionError(error)
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
  private formatToolResult(payload: LlmToolResultEvent): string {
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
   * Stream task results from the connected instance.
   */
  private async streamTaskResults(client: ITransportClient, taskId: string, verbose: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      let completed = false
      let resultPrinted = false // Track if we've already printed the result

      // Timeout after 5 minutes
      const timeout = setTimeout(
        () => {
          if (!completed) {
            completed = true
            cleanup()
            reject(new Error('Task timed out after 5 minutes'))
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
        client.on<TaskStartedEvent>('task:started', (payload) => {
          if (payload.taskId === taskId && verbose) {
            this.terminal.log('Task started processing...')
          }
        }),

        // llmservice:chunk - streaming content (for future release)
        // client.on<LlmChunkPayload>('llmservice:chunk', (payload) => {
        //   if (payload.taskId === taskId) {
        //     if (!hasReceivedChunks) {
        //       this.terminal.log('\nResult:')
        //     }
        //     hasReceivedChunks = true
        //     process.stdout.write(payload.content)
        //   }
        // }),

        // llmservice:response - final response from LLM (only print once)
        client.on<LlmResponseEvent>('llmservice:response', (payload) => {
          if (payload.taskId === taskId && payload.content && !resultPrinted) {
            resultPrinted = true
            this.terminal.log('\nResult:')
            this.terminal.log(payload.content)
          }
        }),

        // llmservice:toolCall - tool invocation (stop showing after response)
        client.on<LlmToolCallEvent>('llmservice:toolCall', (payload) => {
          if (payload.taskId === taskId && !resultPrinted) {
            const detail = payload.args ? this.formatToolArgs(payload.toolName, payload.args) : ''
            const suffix = detail ? `: ${detail}` : ''
            this.terminal.log(`🔧 ${payload.toolName}${suffix}`)
          }
        }),

        // llmservice:toolResult - tool result with summary (stop showing after response)
        client.on<LlmToolResultEvent>('llmservice:toolResult', (payload) => {
          if (payload.taskId === taskId && !resultPrinted) {
            const status = payload.success ? '✓' : '✗'
            const resultSummary = this.formatToolResult(payload)
            this.terminal.log(`  ${status} ${resultSummary}`)
          }
        }),

        // task:completed - task finished (chunks already streamed, just resolve)
        client.on<TaskCompletedEvent>('task:completed', (payload) => {
          if (payload.taskId === taskId && !completed) {
            completed = true
            cleanup()
            // Note: Don't log result here - chunks already streamed it
            this.terminal.log('') // Final newline for clean output
            resolve()
          }
        }),

        // task:error - task failed
        client.on<TaskErrorEvent>('task:error', (payload) => {
          if (payload.taskId === taskId && !completed) {
            completed = true
            cleanup()
            reject(new Error(payload.error.message))
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
