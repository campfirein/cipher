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

        // task:toolCall - tool invocation (always show - important feedback)
        client.on<TaskToolCallPayload>('task:toolCall', (payload) => {
          if (payload.taskId === taskId) {
            this.log(`\n🔧 Tool: ${payload.name}`)
          }
        }),

        // task:toolResult - tool result (always show - important feedback)
        client.on<TaskToolResultPayload>('task:toolResult', (payload) => {
          if (payload.taskId === taskId) {
            const status = payload.success ? '✓' : '✗'
            this.log(`   ${status} Result received`)
          }
        }),

        // task:completed - task finished
        client.on<TaskCompletedPayload>('task:completed', (payload) => {
          if (payload.taskId === taskId && !completed) {
            completed = true
            cleanup()

            // Display the result (final response from agent)
            if (payload.result) {
              this.log(`\n${payload.result}`)
            }

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
