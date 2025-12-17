import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {ILogger} from '../../core/interfaces/cipher/i-logger.js'
import type {ICurateUseCase, ToolCallInfo, ToolResultInfo} from '../../core/interfaces/usecase/i-curate-use-case.js'
import type {IQueryUseCase} from '../../core/interfaces/usecase/i-query-use-case.js'

import {NoOpLogger} from '../../core/interfaces/cipher/i-logger.js'

/**
 * Task input for processing.
 */
export type TaskInput = {
  /** Task content/prompt */
  content: string
  /** Optional file references */
  fileReferenceInstructions?: string
  /** Task ID */
  taskId: string
  /** Task type */
  type: 'curate' | 'query'
}

/**
 * Callbacks for streaming task results.
 * These are called by TaskProcessor to stream results back via Transport.
 */
export type TaskCallbacks = {
  /** Called on each streaming chunk */
  onChunk?: (content: string) => void
  /** Called when task processing completes */
  onCompleted?: (result: string) => void
  /** Called when task encounters an error */
  onError?: (error: string) => void
  /** Called when task actually starts processing */
  onStarted?: () => void
  /** Called when a tool is invoked */
  onToolCall?: (info: ToolCallInfo) => void
  /** Called when a tool returns a result */
  onToolResult?: (info: ToolResultInfo) => void
}

/**
 * Configuration for TaskProcessor.
 */
export type TaskProcessorConfig = {
  /** Auth token for LLM API */
  authToken?: {accessToken: string; sessionKey: string}
  /** Project config */
  brvConfig?: BrvConfig
  /** Curate use case instance (injected by CoreProcess) */
  curateUseCase: ICurateUseCase
  /** Logger instance */
  logger?: ILogger
  /** Query use case instance (injected by CoreProcess) */
  queryUseCase: IQueryUseCase
}

/**
 * TaskProcessor - Processes tasks directly (no SQLite queue).
 *
 * Architecture v7:
 * - Transport routes task:create directly to TaskProcessor
 * - TaskProcessor delegates to UseCase.run()
 * - UseCase contains business logic (validation, tracking, CipherAgent orchestration)
 * - Results stream back via callbacks (wired to Transport by CoreProcess)
 *
 * Flow: Transport → TaskProcessor → UseCase → CipherAgent
 *
 * This replaces the SQLite-based ExecutionConsumer for task routing.
 * SQLite is only used by SessionManager for history/context.
 */
export class TaskProcessor {
  private authToken: undefined | {accessToken: string; sessionKey: string}
  private readonly brvConfig: BrvConfig | undefined
  private readonly curateUseCase: ICurateUseCase
  private readonly logger: ILogger
  private readonly queryUseCase: IQueryUseCase
  /** Track running tasks for cancellation */
  private readonly runningTasks = new Map<string, {abort: () => void}>()

  constructor(config: TaskProcessorConfig) {
    this.authToken = config.authToken
    this.brvConfig = config.brvConfig
    this.logger = config.logger ?? new NoOpLogger()

    // UseCase instances are injected by CoreProcess (with real dependencies)
    this.curateUseCase = config.curateUseCase
    this.queryUseCase = config.queryUseCase
  }

  /**
   * Cancel a running task.
   */
  cancel(taskId: string): boolean {
    const task = this.runningTasks.get(taskId)
    if (task) {
      task.abort()
      this.runningTasks.delete(taskId)
      return true
    }

    return false
  }

  /**
   * Check if a task is running.
   */
  isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId)
  }

  /**
   * Process a task directly (no queuing).
   * Delegates to UseCase.run() for business logic.
   * Results stream back via callbacks.
   */
  async process(input: TaskInput, callbacks?: TaskCallbacks): Promise<void> {
    const {content, taskId, type} = input

    this.logger.info('Processing task', {taskId, type})

    // Check auth
    if (!this.authToken) {
      this.logger.error('No auth token', {taskId})
      callbacks?.onError?.('Not authenticated. Please run "brv login" first.')
      return
    }

    // Track task for cancellation
    let aborted = false
    const abort = (): void => {
      aborted = true
    }

    this.runningTasks.set(taskId, {abort})

    try {
      // Delegate to UseCase based on task type
      switch (type) {
        case 'curate': {
          await this.curateUseCase.runForTransport(
            {
              authToken: this.authToken,
              brvConfig: this.brvConfig,
              content,
              fileReferenceInstructions: input.fileReferenceInstructions,
            },
            {
              onChunk(chunk) {
                if (!aborted) callbacks?.onChunk?.(chunk)
              },
              onCompleted: (result) => {
                if (!aborted) {
                  this.logger.info('Task completed', {taskId})
                  callbacks?.onCompleted?.(result)
                }
              },
              onError: (error) => {
                this.logger.error('Task failed', {error, taskId})
                callbacks?.onError?.(error)
              },
              onStarted() {
                callbacks?.onStarted?.()
              },
              onToolCall(info) {
                if (!aborted) callbacks?.onToolCall?.(info)
              },
              onToolResult(info) {
                if (!aborted) callbacks?.onToolResult?.(info)
              },
            },
          )
          break
        }

        case 'query': {
          await this.queryUseCase.runForTransport(
            {
              authToken: this.authToken,
              brvConfig: this.brvConfig,
              query: content,
            },
            {
              onChunk(chunk) {
                if (!aborted) callbacks?.onChunk?.(chunk)
              },
              onCompleted: (result) => {
                if (!aborted) {
                  this.logger.info('Task completed', {taskId})
                  callbacks?.onCompleted?.(result)
                }
              },
              onError: (error) => {
                this.logger.error('Task failed', {error, taskId})
                callbacks?.onError?.(error)
              },
              onStarted() {
                callbacks?.onStarted?.()
              },
              onToolCall(info) {
                if (!aborted) callbacks?.onToolCall?.(info)
              },
              onToolResult(info) {
                if (!aborted) callbacks?.onToolResult?.(info)
              },
            },
          )
          break
        }
      }

      // Handle aborted case
      if (aborted) {
        this.logger.info('Task aborted', {taskId})
        callbacks?.onError?.('Task cancelled')
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger.error('Task failed', {error: errorMessage, taskId})
      callbacks?.onError?.(errorMessage)
    } finally {
      this.runningTasks.delete(taskId)
    }
  }

  /**
   * Set auth token (can be set after construction).
   */
  setAuthToken(token: {accessToken: string; sessionKey: string}): void {
    this.authToken = token
  }
}

/**
 * Create a new TaskProcessor instance.
 */
export function createTaskProcessor(config: TaskProcessorConfig): TaskProcessor {
  return new TaskProcessor(config)
}
