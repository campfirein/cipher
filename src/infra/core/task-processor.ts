import type {BrvConfig} from '../../core/domain/entities/brv-config.js'
import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
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
  /** Session ID (for agent lookup in v7 architecture) */
  sessionId?: string
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
  /** Auth token for LLM API (legacy flow) */
  authToken?: {accessToken: string; sessionKey: string}
  /** Project config (legacy flow) */
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
 * Architecture v0.5.0:
 * - Transport routes task:create directly to TaskProcessor
 * - TaskProcessor receives single agent reference from CoreProcess via setAgent()
 * - TaskProcessor passes agent to UseCase.executeWithAgent()
 * - UseCase contains business logic (validation, tracking) - doesn't manage agent lifecycle
 * - Results stream back via callbacks (wired to Transport by CoreProcess)
 *
 * Flow: Transport → TaskProcessor → UseCase.executeWithAgent(agent, ...)
 *
 * Agent lifecycle:
 * - CoreProcess owns the single CipherAgent
 * - CoreProcess calls taskProcessor.setAgent(agent) after agent starts
 * - TaskProcessor holds reference, passes to UseCases
 */
export class TaskProcessor {
  /**
   * Single CipherAgent reference from CoreProcess.
   * Architecture v0.5.0: 1 Agent per Core, set via setAgent().
   */
  private agent: ICipherAgent | undefined
  private authToken: undefined | {accessToken: string; sessionKey: string}
  private brvConfig: BrvConfig | undefined
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
   *
   * Architecture v0.5.0 flow (when agent is set):
   * 1. Use single agent from CoreProcess
   * 2. Pass agent to UseCase.executeWithAgent()
   * 3. Agent survives for future tasks
   *
   * Legacy flow (backward compatibility):
   * - UseCase.runForTransport() creates its own agent per task
   *
   * Results stream back via callbacks.
   */
  async process(input: TaskInput, callbacks?: TaskCallbacks): Promise<void> {
    const {taskId, type} = input

    this.logger.info('Processing task', {taskId, type})

    // Track task for cancellation
    let aborted = false
    const abort = (): void => {
      aborted = true
    }

    this.runningTasks.set(taskId, {abort})

    // Create streaming callbacks with abort check
    const streamingCallbacks = {
      onChunk(chunk: string) {
        if (!aborted) callbacks?.onChunk?.(chunk)
      },
      onCompleted: (result: string) => {
        if (!aborted) {
          this.logger.info('Task completed', {taskId})
          callbacks?.onCompleted?.(result)
        }
      },
      onError: (error: string) => {
        this.logger.error('Task failed', {error, taskId})
        callbacks?.onError?.(error)
      },
      onStarted() {
        callbacks?.onStarted?.()
      },
      onToolCall(info: ToolCallInfo) {
        if (!aborted) callbacks?.onToolCall?.(info)
      },
      onToolResult(info: ToolResultInfo) {
        if (!aborted) callbacks?.onToolResult?.(info)
      },
    }

    try {
      // v0.5.0 Architecture: Use single agent from CoreProcess
      // eslint-disable-next-line unicorn/prefer-ternary -- ternary is less readable for different async calls
      if (this.agent) {
        await this.processWithAgent(input, streamingCallbacks)
      } else {
        // Legacy: Use runForTransport (creates agent per task)
        await this.processLegacy(input, streamingCallbacks)
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
   * Set agent reference from CoreProcess.
   * Architecture v0.5.0: CoreProcess owns agent, passes reference here.
   */
  setAgent(agent: ICipherAgent): void {
    this.agent = agent
    this.logger.debug('Agent reference set')
  }

  /**
   * Set auth token (can be set after construction).
   * @deprecated Legacy flow - v0.5.0 uses agent injection
   */
  setAuthToken(token: {accessToken: string; sessionKey: string}): void {
    this.authToken = token
  }

  /**
   * Set project config (can be set after construction).
   * @deprecated Legacy flow - v0.5.0 uses agent injection
   */
  setBrvConfig(config: BrvConfig): void {
    this.brvConfig = config
  }

  /**
   * Process task using legacy flow (runForTransport).
   * Each task creates its own agent.
   *
   * @deprecated Use processWithAgentSessionManager for v7 architecture
   */
  private async processLegacy(
    input: TaskInput,
    callbacks: {
      onChunk: (chunk: string) => void
      onCompleted: (result: string) => void
      onError: (error: string) => void
      onStarted: () => void
      onToolCall: (info: ToolCallInfo) => void
      onToolResult: (info: ToolResultInfo) => void
    },
  ): Promise<void> {
    const {content, type} = input

    // Check auth (only needed for legacy flow - v7 uses AgentSessionManager's auth)
    if (!this.authToken) {
      this.logger.error('No auth token', {taskId: input.taskId})
      callbacks.onError('Not authenticated. Please run "brv login" first.')
      return
    }

    switch (type) {
      case 'curate': {
        await this.curateUseCase.runForTransport(
          {
            authToken: this.authToken,
            brvConfig: this.brvConfig,
            content,
            fileReferenceInstructions: input.fileReferenceInstructions,
          },
          callbacks,
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
          callbacks,
        )
        break
      }
    }
  }

  /**
   * Process task using v0.5.0 architecture with single agent.
   * Uses long-lived agent from CoreProcess, passes to UseCase.executeWithAgent().
   */
  private async processWithAgent(
    input: TaskInput,
    callbacks: {
      onChunk: (chunk: string) => void
      onCompleted: (result: string) => void
      onError: (error: string) => void
      onStarted: () => void
      onToolCall: (info: ToolCallInfo) => void
      onToolResult: (info: ToolResultInfo) => void
    },
  ): Promise<void> {
    const {content, type} = input

    if (!this.agent) {
      throw new Error('Agent not configured. CoreProcess should call setAgent() first.')
    }

    this.logger.debug('Processing with agent', {type})

    // Delegate to UseCase with injected agent
    switch (type) {
      case 'curate': {
        await this.curateUseCase.executeWithAgent(
          this.agent,
          {
            content,
            fileReferenceInstructions: input.fileReferenceInstructions,
          },
          callbacks,
        )
        break
      }

      case 'query': {
        await this.queryUseCase.executeWithAgent(this.agent, {query: content}, callbacks)
        break
      }
    }
  }
}

/**
 * Create a new TaskProcessor instance.
 */
export function createTaskProcessor(config: TaskProcessorConfig): TaskProcessor {
  return new TaskProcessor(config)
}
