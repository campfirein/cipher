import {Args, Command, Flags} from '@oclif/core'

import type {TaskCreateResponse} from '../core/domain/transport/schemas.js'
import type {ITransportClient} from '../core/interfaces/transport/i-transport-client.js'

import {isDevelopment} from '../config/environment.js'

/** Parsed flags type */
type QueryFlags = {
  verbose?: boolean
}
import {
  ConnectionError,
  ConnectionFailedError,
  InstanceCrashedError,
  NoInstanceRunningError,
} from '../core/domain/errors/connection-error.js'
import {createTransportClientFactory} from '../infra/transport/transport-client-factory.js'
import {getSandboxEnvironmentName, isSandboxEnvironment, isSandboxNetworkError} from '../utils/sandbox-detector.js'

/**
 * Task lifecycle payloads (Transport-generated)
 */
type TaskAckPayload = {taskId: string}
type TaskStartedPayload = {taskId: string}
type TaskCompletedPayload = {taskId: string}
type TaskErrorPayload = {
  error: {code?: string; details?: Record<string, unknown>; message: string; name: string}
  taskId: string
}

/**
 * LLM service payloads (forwarded from Agent with original names)
 */
// type LlmChunkPayload = {content: string; isComplete?: boolean; taskId: string; type: 'reasoning' | 'text'}
type LlmResponsePayload = {content: string; taskId: string}
type LlmToolCallPayload = {args?: Record<string, unknown>; callId: string; name: string; taskId: string}
type LlmToolResultPayload = {callId: string; error?: string; result?: unknown; success: boolean; taskId: string}

export default class Query extends Command {
  public static args = {
    query: Args.string({
      description: 'Natural language question about your codebase or project knowledge',
      required: true,
    }),
  }
  public static description = `Query and retrieve information from the context tree (connects to running brv instance)

Requires a running brv instance. Start one with: brv start

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
  ]
  public static flags = {
    ...(isDevelopment()
      ? {
          verbose: Flags.boolean({
            char: 'v',
            default: false,
            description: 'Enable verbose debug output [Development only]',
          }),
        }
      : {}),
  }
  public static strict = false

  public async run(): Promise<void> {
    const {argv, flags: rawFlags} = await this.parse(Query)
    const flags = rawFlags as QueryFlags
    const queryTerms = (argv as string[]).join(' ')

    if (!queryTerms.trim()) {
      this.log('Query argument is required.')
      this.log('Usage: brv query "your question here"')
      return
    }

    const verbose = flags.verbose ?? false

    // Connect to running instance
    let client: ITransportClient | undefined

    try {
      const factory = createTransportClientFactory()

      if (verbose) {
        this.log('Discovering running instance...')
      }

      const {client: connectedClient} = await factory.connect()
      client = connectedClient

      if (verbose) {
        this.log(`Connected to instance (clientId: ${client.getClientId()})`)
      }

      // Send task:create request
      const response = await client.request<TaskCreateResponse>('task:create', {
        input: queryTerms,
        type: 'query',
      })

      const {taskId} = response

      if (verbose) {
        this.log(`Task created: ${taskId}`)
      }

      // Wait for task completion with streaming
      await this.streamTaskResults(client, taskId, verbose)
    } catch (error) {
      this.handleConnectionError(error)
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
  private formatToolResult(payload: LlmToolResultPayload): string {
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
        this.error(
          `Error: No ByteRover instance is running.\n` +
            `⚠️  Sandbox environment detected (${sandboxName}).\n\n` +
            `Please run 'brv' command in a separate terminal window/tab outside the sandbox first.`,
          {exit: 1},
        )
      } else {
        this.error(
          'No ByteRover instance is running.\n\n' +
            'Start a ByteRover instance by running "brv" in a separate terminal window/tab.\n' +
            'The instance will keep running and handle your commands.',
          {exit: 1},
        )
      }
    }

    if (error instanceof InstanceCrashedError) {
      this.error('ByteRover instance has crashed.\n\nPlease restart with: brv', {exit: 1})
    }

    if (error instanceof ConnectionFailedError) {
      // Check if it's specifically a sandbox network restriction error
      const isSandboxError = isSandboxNetworkError(error.originalError ?? error)

      if (isSandboxError) {
        const sandboxName = getSandboxEnvironmentName()
        this.error(
          `Error: Failed to connect to ByteRover instance.\n` +
            `Port: ${error.port ?? 'unknown'}\n` +
            `⚠️  Sandbox network restriction detected (${sandboxName}).\n\n` +
            `Please allow network access in the sandbox and retry the command.`,
          {exit: 1},
        )
      } else {
        this.error(`Failed to connect to ByteRover instance: ${error.message}`, {exit: 1})
      }
    }

    if (error instanceof ConnectionError) {
      this.error(`Connection error: ${error.message}`, {exit: 1})
    }

    // Unknown error
    const message = error instanceof Error ? error.message : String(error)
    this.error(`Unexpected error: ${message}`, {exit: 1})
  }

  /**
   * Stream task results from the connected instance.
   */
  private async streamTaskResults(client: ITransportClient, taskId: string, verbose: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      let completed = false
      let resultPrinted = false // Track if we've already printed the result

      // Timeout after 5 minutes
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true
          cleanup()
          reject(new Error('Task timed out after 5 minutes'))
        }
      }, 5 * 60 * 1000)

      // Setup all event handlers
      const unsubscribers = [
        // task:ack - immediate acknowledgment
        client.on<TaskAckPayload>('task:ack', (payload) => {
          if (payload.taskId === taskId && verbose) {
            this.log('Task acknowledged by server')
          }
        }),

        // task:started - task is being processed
        client.on<TaskStartedPayload>('task:started', (payload) => {
          if (payload.taskId === taskId && verbose) {
            this.log('Task started processing...')
          }
        }),

        // llmservice:chunk - streaming content (for future release)
        // client.on<LlmChunkPayload>('llmservice:chunk', (payload) => {
        //   if (payload.taskId === taskId) {
        //     if (!hasReceivedChunks) {
        //       this.log('\nResult:')
        //     }
        //     hasReceivedChunks = true
        //     process.stdout.write(payload.content)
        //   }
        // }),

        // llmservice:response - final response from LLM (only print once)
        client.on<LlmResponsePayload>('llmservice:response', (payload) => {
          if (payload.taskId === taskId && payload.content && !resultPrinted) {
            resultPrinted = true
            this.log('\nResult:')
            this.log(payload.content)
          }
        }),

        // llmservice:toolCall - tool invocation (stop showing after response)
        client.on<LlmToolCallPayload>('llmservice:toolCall', (payload) => {
          if (payload.taskId === taskId && !resultPrinted) {
            const detail = payload.args ? this.formatToolArgs(payload.name, payload.args) : ''
            const suffix = detail ? `: ${detail}` : ''
            this.log(`🔧 ${payload.name}${suffix}`)
          }
        }),

        // llmservice:toolResult - tool result with summary (stop showing after response)
        client.on<LlmToolResultPayload>('llmservice:toolResult', (payload) => {
          if (payload.taskId === taskId && !resultPrinted) {
            const status = payload.success ? '✓' : '✗'
            const resultSummary = this.formatToolResult(payload)
            this.log(`  ${status} ${resultSummary}`)
          }
        }),

        // task:completed - task finished (chunks already streamed, just resolve)
        client.on<TaskCompletedPayload>('task:completed', (payload) => {
          if (payload.taskId === taskId && !completed) {
            completed = true
            cleanup()
            // Note: Don't log result here - chunks already streamed it
            this.log('') // Final newline for clean output
            resolve()
          }
        }),

        // task:error - task failed
        client.on<TaskErrorPayload>('task:error', (payload) => {
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
