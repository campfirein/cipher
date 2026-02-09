import {
  ConnectionError,
  ConnectionFailedError,
  DaemonSpawnError,
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

import type {ITerminal} from '../../core/interfaces/services/i-terminal.js'
import type {ITrackingService} from '../../core/interfaces/services/i-tracking-service.js'
import type {IQueryUseCase, QueryUseCaseRunOptions} from '../../core/interfaces/usecase/i-query-use-case.js'

import {TaskErrorCode} from '../../core/domain/errors/task-error.js'
import {formatError} from '../../utils/error-handler.js'
import {getSandboxEnvironmentName, isSandboxEnvironment, isSandboxNetworkError} from '../../utils/sandbox-detector.js'
import {HeadlessTerminal} from '../terminal/headless-terminal.js'
import {createDaemonAwareConnector, type TransportConnector} from '../transport/transport-connector.js'

export type {TransportConnector} from '../transport/transport-connector.js'

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
  /** Delay between retry attempts (ms). Default: 2000. Set to 0 in tests. */
  retryDelayMs?: number
  terminal: ITerminal
  trackingService: ITrackingService
  /** Optional transport connector for dependency injection (defaults to connectToTransport) */
  transportConnector?: TransportConnector
}

/** Max retry attempts when daemon disconnects mid-task */
const MAX_TASK_RETRIES = 3
/** Delay between retry attempts (ms) */
const RETRY_DELAY_MS = 2000
/** Grace period before treating 'reconnecting' as daemon death (ms) */
const DISCONNECT_GRACE_MS = 10_000

export class QueryUseCase implements IQueryUseCase {
  private readonly retryDelayMs: number
  private readonly terminal: ITerminal
  private readonly trackingService: ITrackingService
  private readonly transportConnector: TransportConnector

  constructor(options: QueryUseCaseOptions) {
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS
    this.terminal = options.terminal
    this.trackingService = options.trackingService
    this.transportConnector = options.transportConnector ?? createDaemonAwareConnector()
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

    // Retry loop: reconnect + resubmit on daemon/agent disconnection
    let lastError: unknown

    /* eslint-disable no-await-in-loop -- intentional sequential retry loop */
    for (let attempt = 1; attempt <= MAX_TASK_RETRIES; attempt++) {
      let client: ITransportClient | undefined
      let projectRoot: string | undefined

      try {
        if (options.headless) {
          const {InlineAgent} = await import('../process/inline-agent-executor.js')
          const inlineAgent = await InlineAgent.create()
          client = inlineAgent.transportClient
        } else {
          if (verbose) {
            this.terminal.log('Discovering running instance...')
          }

          const result = await this.transportConnector()
          client = result.client
          projectRoot = result.projectRoot
        }

        if (verbose) {
          this.terminal.log(`Connected to instance (clientId: ${client.getClientId()})`)
        }

        const taskId = randomUUID()
        const streamPromise = this.streamTaskResults(client, taskId, verbose, format)

        await client.requestWithAck<TaskAck>('task:create', {
          clientCwd: process.cwd(),
          content: options.query,
          ...(projectRoot ? {projectPath: projectRoot} : {}),
          taskId,
          type: 'query',
        })

        if (verbose) {
          this.terminal.log(`Task created: ${taskId}`)
        }

        await streamPromise
        await this.trackingService.track('mem:query', {status: 'finished'})

        // Success: cleanup and return
        await client.disconnect().catch(() => {})
        return
      } catch (error) {
        if (client) {
          await client.disconnect().catch(() => {})
        }

        lastError = error

        // Retry only for daemon/agent infrastructure failures
        if (!options.headless && this.isRetryableError(error) && attempt < MAX_TASK_RETRIES) {
          if (format === 'text') {
            this.terminal.log(`\nConnection lost. Restarting daemon... (attempt ${attempt + 1}/${MAX_TASK_RETRIES})`)
          }

          await new Promise<void>((resolve) => {
            setTimeout(resolve, this.retryDelayMs)
          })

          continue
        }

        break
      }
    }
    /* eslint-enable no-await-in-loop */

    // All retries exhausted or non-retryable error
    if (format === 'json') {
      this.handleConnectionErrorJson(lastError)
    } else {
      this.handleConnectionError(lastError)
    }

    await this.trackingService.track('mem:query', {message: formatError(lastError), status: 'error'})

    // Force exit only for task-level disconnects (AGENT_DISCONNECTED) where Socket.IO
    // handles may leak. Connection errors (DaemonSpawnError, ConnectionFailedError) already
    // cleaned up their clients — no leaked handles.
    if (this.hasLeakedHandles(lastError)) {
      // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
      process.exit(1)
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
   * Checks if an error left leaked Socket.IO handles that prevent Node.js from exiting.
   * Only task-level disconnects (mid-task daemon death) leak handles.
   * Connection errors (DaemonSpawnError, ConnectionFailedError) clean up their clients.
   */
  private hasLeakedHandles(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    if (!('code' in error)) return false
    return error.code === TaskErrorCode.AGENT_DISCONNECTED || error.code === TaskErrorCode.AGENT_NOT_AVAILABLE
  }

  /**
   * Checks if an error is retryable (daemon/agent infrastructure failure).
   * Retryable: agent disconnected, agent not available, daemon spawn timeout, connection failed.
   * Non-retryable: auth errors, project not init, LLM errors, file validation, no instance running.
   */
  private isRetryableError(error: unknown): boolean {
    // Connection infrastructure errors — daemon spawned but slow, or connection dropped
    if (error instanceof DaemonSpawnError || error instanceof ConnectionFailedError) return true
    // Task-level errors — agent disconnected mid-task
    return this.hasLeakedHandles(error)
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
      let disconnectTimer: NodeJS.Timeout | undefined
      const toolCalls: Array<{status: string; summary: string; tool: string}> = []

      const rejectRetryable = (message: string): void => {
        if (completed) return
        completed = true
        cleanup()
        reject(Object.assign(new Error(message), {code: TaskErrorCode.AGENT_DISCONNECTED}))
      }

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

        // task:error - task failed (preserve error code for retry detection)
        client.on<TaskError>('task:error', (payload) => {
          if (payload.taskId === taskId && !completed) {
            completed = true
            cleanup()

            if (format === 'json') {
              this.outputJsonResult({error: payload.error.message, status: 'error'})
              resolve()
            } else {
              reject(Object.assign(new Error(payload.error.message), {code: payload.error.code}))
            }
          }
        }),

        // Disconnect detection: fast recovery when daemon dies (SIGKILL)
        // SIGTERM: task:error arrives first (handled above). SIGKILL: no event, only state change.
        client.onStateChange((state) => {
          if (completed) return

          if (state === 'reconnecting') {
            // Grace period: daemon might recover via Socket.IO built-in reconnect
            disconnectTimer = setTimeout(() => {
              rejectRetryable('Daemon disconnected')
            }, DISCONNECT_GRACE_MS)
          }

          if (state === 'connected' && disconnectTimer) {
            // Reconnected within grace period — cancel and continue waiting for task
            clearTimeout(disconnectTimer)
            disconnectTimer = undefined
          }

          if (state === 'disconnected') {
            // All reconnection tiers exhausted
            if (disconnectTimer) {
              clearTimeout(disconnectTimer)
              disconnectTimer = undefined
            }

            rejectRetryable('Daemon disconnected')
          }
        }),

        // Clear timers
        () => clearTimeout(timeout),
        () => {
          if (disconnectTimer) clearTimeout(disconnectTimer)
        },
      ]

      const cleanup = (): void => {
        for (const unsub of unsubscribers) unsub()
      }
    })
  }
}
