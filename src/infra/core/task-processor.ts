import type {ICipherAgent} from '../../core/interfaces/cipher/i-cipher-agent.js'
import type {ILogger} from '../../core/interfaces/cipher/i-logger.js'
import type {ICurateUseCase} from '../../core/interfaces/usecase/i-curate-use-case.js'
import type {IQueryUseCase} from '../../core/interfaces/usecase/i-query-use-case.js'

import {NoOpLogger} from '../../core/interfaces/cipher/i-logger.js'

/**
 * Task input for processing.
 */
export type TaskInput = {
  /** Task content/prompt */
  content: string
  /** Optional file paths for curate --files */
  files?: string[]
  /** Task ID */
  taskId: string
  /** Task type */
  type: 'curate' | 'query'
}

/**
 * Configuration for TaskProcessor.
 */
export type TaskProcessorConfig = {
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
 * - TaskProcessor receives single agent reference via setAgent()
 * - TaskProcessor passes agent to UseCase.executeWithAgent()
 * - UseCase contains business logic (validation, prompt building)
 * - Event streaming handled by agent-worker (subscribes to agentEventBus)
 *
 * Flow: agent-worker → TaskProcessor.process() → UseCase.executeWithAgent()
 */
export class TaskProcessor {
  /**
   * Single CipherAgent reference from agent-worker.
   */
  private agent: ICipherAgent | undefined
  private readonly curateUseCase: ICurateUseCase
  private readonly logger: ILogger
  private readonly queryUseCase: IQueryUseCase
  /** Track running tasks for cancellation */
  private readonly runningTasks = new Map<string, {abort: () => void}>()

  constructor(config: TaskProcessorConfig) {
    this.logger = config.logger ?? new NoOpLogger()
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
   * Process a task and return the result.
   *
   * Architecture v0.5.0:
   * - Calls UseCase.executeWithAgent() with long-lived agent
   * - Returns result string
   * - Event streaming handled by agent-worker (agentEventBus)
   */
  async process(input: TaskInput): Promise<string> {
    const {taskId, type} = input

    this.logger.info('Processing task', {taskId, type})

    if (!this.agent) {
      throw new Error('Agent not configured. Call setAgent() first.')
    }

    // Track task for cancellation
    let aborted = false
    const abort = (): void => {
      aborted = true
    }

    this.runningTasks.set(taskId, {abort})

    try {
      const result = await this.executeWithAgent(input)

      if (aborted) {
        throw new Error('Task cancelled')
      }

      this.logger.info('Task completed', {taskId})
      return result
    } finally {
      this.runningTasks.delete(taskId)
    }
  }

  /**
   * Set agent reference from agent-worker.
   */
  setAgent(agent: ICipherAgent): void {
    this.agent = agent
    this.logger.debug('Agent reference set')
  }

  /**
   * Execute task with the injected agent.
   */
  private async executeWithAgent(input: TaskInput): Promise<string> {
    const {content, type} = input

    if (!this.agent) {
      throw new Error('Agent not configured')
    }

    this.logger.debug('Executing with agent', {type})

    switch (type) {
      case 'curate': {
        return this.curateUseCase.executeWithAgent(this.agent, {
          content,
          files: input.files,
        })
      }

      case 'query': {
        return this.queryUseCase.executeWithAgent(this.agent, {query: content})
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
