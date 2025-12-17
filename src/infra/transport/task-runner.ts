import type {
  ChunkPayload,
  ExecutionTerminatedPayload,
  ResponsePayload,
  TaskCreateRequest,
  TaskCreateResponse,
  ToolCallPayload,
  ToolResultPayload,
} from '../../core/domain/transport/schemas.js'
import type {ILogger} from '../../core/interfaces/cipher/i-logger.js'
import type {ITransportClient} from '../../core/interfaces/transport/i-transport-client.js'

import {TransportEventNames} from '../../core/domain/transport/schemas.js'
import {NoOpLogger} from '../../core/interfaces/cipher/i-logger.js'
import {createTransportClientFactory, TransportClientFactory} from './transport-client-factory.js'

/**
 * Callbacks for streaming task events.
 */
export type TaskEventCallbacks = {
  /** Called for each streaming chunk */
  onChunk?: (payload: ChunkPayload) => void
  /** Called on error */
  onError?: (error: Error) => void
  /** Called when response is complete */
  onResponse?: (payload: ResponsePayload) => void
  /** Called when task execution starts */
  onStarted?: (taskId: string) => void
  /** Called when execution terminates */
  onTerminated?: (payload: ExecutionTerminatedPayload) => void
  /** Called for tool calls */
  onToolCall?: (payload: ToolCallPayload) => void
  /** Called for tool results */
  onToolResult?: (payload: ToolResultPayload) => void
}

/**
 * Configuration for TaskRunner.
 */
export type TaskRunnerConfig = {
  /** Transport client factory */
  factory?: TransportClientFactory
  /** Logger instance */
  logger?: ILogger
  /** Timeout for task execution in ms (default: 5 minutes) */
  timeoutMs?: number
}

/**
 * Result of task execution.
 */
export type TaskRunResult = {
  /** Error if task failed */
  error?: Error
  /** Final response content (if any) */
  response?: string
  /** Whether the task completed successfully */
  success: boolean
  /** The task ID */
  taskId: string
}

/**
 * TaskRunner - Executes tasks via transport and streams results.
 *
 * Usage:
 * ```typescript
 * const runner = new TaskRunner();
 * const result = await runner.run({
 *   type: 'curate',
 *   input: 'Add auth context',
 * }, {
 *   onChunk: (chunk) => process.stdout.write(chunk.content),
 *   onTerminated: (payload) => console.log('Done!'),
 * });
 * ```
 */
export class TaskRunner {
  private readonly factory: TransportClientFactory
  private readonly logger: ILogger
  private readonly timeoutMs: number

  constructor(config?: TaskRunnerConfig) {
    this.factory = config?.factory ?? createTransportClientFactory()
    this.logger = config?.logger ?? new NoOpLogger()
    this.timeoutMs = config?.timeoutMs ?? 5 * 60 * 1000 // 5 minutes
  }

  /**
   * Convenience method to run a curate task.
   */
  async curate(input: string, callbacks?: TaskEventCallbacks): Promise<TaskRunResult> {
    return this.run({input, type: 'curate'}, callbacks)
  }

  /**
   * Convenience method to run a query task.
   */
  async query(input: string, callbacks?: TaskEventCallbacks): Promise<TaskRunResult> {
    return this.run({input, type: 'query'}, callbacks)
  }

  /**
   * Runs a task and streams results.
   *
   * @param request - Task creation request (type + input)
   * @param callbacks - Optional callbacks for streaming events
   * @returns Task result
   */
  async run(request: TaskCreateRequest, callbacks?: TaskEventCallbacks): Promise<TaskRunResult> {
    let client: ITransportClient | undefined

    try {
      // Connect to instance
      this.logger.debug('Connecting to instance')
      const connection = await this.factory.connect()
      client = connection.client

      this.logger.info('Connected', {projectRoot: connection.projectRoot})

      // Create task
      this.logger.debug('Creating task', {input: request.input, type: request.type})
      const response = await client.request<TaskCreateResponse, TaskCreateRequest>('task:create', request)
      const {taskId} = response

      this.logger.info('Task created', {taskId})

      // Setup event listeners
      const unsubscribers = this.setupEventListeners(client, taskId, callbacks)

      // Wait for task:started
      callbacks?.onStarted?.(taskId)

      // Wait for completion or timeout
      const result = await this.waitForCompletion(client, taskId, callbacks)

      // Cleanup listeners
      for (const unsub of unsubscribers) {
        unsub()
      }

      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.logger.error('Task execution failed', {error: err.message})
      callbacks?.onError?.(err)

      return {
        error: err,
        success: false,
        taskId: '',
      }
    } finally {
      // Always disconnect
      if (client) {
        await client.disconnect()
        this.logger.debug('Disconnected')
      }
    }
  }

  /**
   * Sets up event listeners for streaming.
   */
  private setupEventListeners(
    client: ITransportClient,
    taskId: string,
    callbacks?: TaskEventCallbacks,
  ): Array<() => void> {
    const unsubscribers: Array<() => void> = []

    // Chunk events (streaming text)
    if (callbacks?.onChunk) {
      const unsub = client.on<ChunkPayload>(TransportEventNames.CHUNK, (payload) => {
        callbacks.onChunk?.(payload)
      })
      unsubscribers.push(unsub)
    }

    // Response events (complete response)
    if (callbacks?.onResponse) {
      const unsub = client.on<ResponsePayload>(TransportEventNames.RESPONSE, (payload) => {
        callbacks.onResponse?.(payload)
      })
      unsubscribers.push(unsub)
    }

    // Tool call events
    if (callbacks?.onToolCall) {
      const unsub = client.on<ToolCallPayload>(TransportEventNames.TOOL_CALL, (payload) => {
        callbacks.onToolCall?.(payload)
      })
      unsubscribers.push(unsub)
    }

    // Tool result events
    if (callbacks?.onToolResult) {
      const unsub = client.on<ToolResultPayload>(TransportEventNames.TOOL_RESULT, (payload) => {
        callbacks.onToolResult?.(payload)
      })
      unsubscribers.push(unsub)
    }

    return unsubscribers
  }

  /**
   * Waits for task completion or timeout.
   */
  private waitForCompletion(
    client: ITransportClient,
    taskId: string,
    callbacks?: TaskEventCallbacks,
  ): Promise<TaskRunResult> {
    return new Promise((resolve) => {
      let finalResponse: string | undefined

      // Listen for termination
      const unsubTerminated = client.on<ExecutionTerminatedPayload>(
        TransportEventNames.EXECUTION_TERMINATED,
        (payload) => {
          this.logger.info('Execution terminated', {reason: payload.reason, taskId})
          callbacks?.onTerminated?.(payload)

          unsubTerminated()
          clearTimeout(timeoutTimer)

          resolve({
            response: finalResponse,
            success: payload.reason === 'GOAL',
            taskId,
          })
        },
      )

      // Listen for response to capture final content
      const unsubResponse = client.on<ResponsePayload>(TransportEventNames.RESPONSE, (payload) => {
        if (!payload.partial) {
          finalResponse = payload.content
        }
      })

      // Timeout handler
      const timeoutTimer = setTimeout(() => {
        this.logger.warn('Task timed out', {taskId, timeoutMs: this.timeoutMs})
        unsubTerminated()
        unsubResponse()

        resolve({
          error: new Error(`Task timed out after ${this.timeoutMs}ms`),
          success: false,
          taskId,
        })
      }, this.timeoutMs)
    })
  }
}

/**
 * Singleton runner instance.
 */
let runnerInstance: TaskRunner | undefined

/**
 * Gets or creates the singleton task runner.
 */
export function getTaskRunner(config?: TaskRunnerConfig): TaskRunner {
  if (!runnerInstance) {
    runnerInstance = new TaskRunner(config)
  }

  return runnerInstance
}

/**
 * Creates a new task runner instance.
 */
export function createTaskRunner(config?: TaskRunnerConfig): TaskRunner {
  return new TaskRunner(config)
}
