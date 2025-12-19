import {Args, Command, Flags} from '@oclif/core'

import type {TaskCreateResponse} from '../core/domain/transport/schemas.js'
import type {ITransportClient} from '../core/interfaces/transport/i-transport-client.js'

import {isDevelopment} from '../config/environment.js'
import {
  ConnectionError,
  ConnectionFailedError,
  InstanceCrashedError,
  NoInstanceRunningError,
} from '../core/domain/errors/connection-error.js'
import {createTransportClientFactory} from '../infra/transport/transport-client-factory.js'

/**
 * Task event payloads from Core
 */
type TaskAckPayload = {taskId: string}
type TaskStartedPayload = {taskId: string}
type TaskChunkPayload = {content: string; taskId: string}
type TaskCompletedPayload = {result: string; taskId: string}
type TaskErrorPayload = {error: string; taskId: string}
type TaskToolCallPayload = {args?: Record<string, unknown>; callId: string; name: string; taskId: string}
type TaskToolResultPayload = {callId: string; error?: string; result?: unknown; success: boolean; taskId: string}

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
    const {argv, flags} = await this.parse(Query)
    const queryTerms = (argv as string[]).join(' ')

    if (!queryTerms.trim()) {
      this.log('Query argument is required.')
      this.log('Usage: brv query "your question here"')
      return
    }

    const verbose = (flags as {verbose?: boolean}).verbose ?? false

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
   * Format tool arguments for display.
   * Shows key args in a readable format for agents/humans.
   */
  private formatToolArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args)
    if (entries.length === 0) return ''

    // Show first 2-3 args, truncate values if too long
    const formatted = entries.slice(0, 3).map(([key, value]) => {
      const strValue = typeof value === 'string' ? value : JSON.stringify(value)
      const truncated = strValue.length > 50 ? `${strValue.slice(0, 47)}...` : strValue
      return `${key}="${truncated}"`
    })

    const more = entries.length > 3 ? ` +${entries.length - 3} more` : ''
    return ` (${formatted.join(', ')}${more})`
  }

  /**
   * Format tool result for display.
   * Shows meaningful summary for agents reading the output.
   */
  private formatToolResult(payload: TaskToolResultPayload): string {
    if (!payload.success) {
      return payload.error ? `Error: ${payload.error}` : 'Failed'
    }

    if (!payload.result) return 'Completed'

    // Handle different result types
    if (Array.isArray(payload.result)) {
      return `Found ${payload.result.length} items`
    }

    if (typeof payload.result === 'object') {
      const keys = Object.keys(payload.result as Record<string, unknown>)
      return `Result: {${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`
    }

    if (typeof payload.result === 'string') {
      const truncated = payload.result.length > 60 ? `${payload.result.slice(0, 57)}...` : payload.result
      return truncated
    }

    return 'Completed'
  }

  /**
   * Handle connection-related errors with user-friendly messages.
   */
  private handleConnectionError(error: unknown): void {
    if (error instanceof NoInstanceRunningError) {
      this.error('No ByteRover instance is running.\n\nStart one with: brv start', {exit: 1})
    }

    if (error instanceof InstanceCrashedError) {
      this.error('ByteRover instance has crashed.\n\nPlease restart with: brv start', {exit: 1})
    }

    if (error instanceof ConnectionFailedError) {
      this.error(`Failed to connect to ByteRover instance: ${error.message}`, {exit: 1})
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

        // task:chunk - streaming content
        client.on<TaskChunkPayload>('task:chunk', (payload) => {
          if (payload.taskId === taskId) {
            // Stream chunk to stdout (no newline - chunks build up)
            process.stdout.write(payload.content)
          }
        }),

        // task:toolCall - tool invocation with args (important feedback for agents)
        client.on<TaskToolCallPayload>('task:toolCall', (payload) => {
          if (payload.taskId === taskId) {
            const argsStr = payload.args ? this.formatToolArgs(payload.args) : ''
            this.log(`\n🔧 Tool: ${payload.name}${argsStr}`)
          }
        }),

        // task:toolResult - tool result with summary (important feedback for agents)
        client.on<TaskToolResultPayload>('task:toolResult', (payload) => {
          if (payload.taskId === taskId) {
            const status = payload.success ? '✓' : '✗'
            const resultSummary = this.formatToolResult(payload)
            this.log(`   ${status} ${resultSummary}`)
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
            reject(new Error(payload.error))
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
