import type {ICipherAgent} from '../../../agent/core/interfaces/i-cipher-agent.js'
import type {ILogger} from '../../../agent/core/interfaces/i-logger.js'
import type {ICurateExecutor} from '../../core/interfaces/executor/i-curate-executor.js'
import type {IQueryExecutor} from '../../core/interfaces/executor/i-query-executor.js'

import {NoOpLogger} from '../../../agent/core/interfaces/i-logger.js'

/**
 * Task input for processing.
 * Agent uses its default session (Single-Session pattern).
 */
export type TaskInput = {
  /** Client's working directory for file validation */
  clientCwd?: string
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
  /** Curate executor instance (injected by agent-worker) */
  curateExecutor: ICurateExecutor
  /** Logger instance */
  logger?: ILogger
  /** Query executor instance (injected by agent-worker) */
  queryExecutor: IQueryExecutor
}

/**
 * TaskProcessor - Coordinates task execution with injected executors.
 *
 * Architecture:
 * - TaskProcessor receives single agent reference via setAgent()
 * - TaskProcessor passes agent to Executor.executeWithAgent()
 * - Executor handles execution (validation, prompt building)
 * - Event streaming handled by agent-worker (subscribes to agentEventBus)
 *
 * Flow: agent-worker → TaskProcessor.process() → Executor.executeWithAgent()
 */
export class TaskProcessor {
  /**
   * Single CipherAgent reference from agent-worker.
   */
  private agent: ICipherAgent | undefined
  private readonly curateExecutor: ICurateExecutor
  private readonly logger: ILogger
  private readonly queryExecutor: IQueryExecutor
  /** Track running tasks for cancellation */
  private readonly runningTasks = new Map<string, {abort: () => void}>()

  constructor(config: TaskProcessorConfig) {
    this.logger = config.logger ?? new NoOpLogger()
    this.curateExecutor = config.curateExecutor
    this.queryExecutor = config.queryExecutor
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
   * Architecture:
   * - Calls Executor.executeWithAgent() with long-lived agent
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
    const {content, taskId, type} = input

    if (!this.agent) {
      throw new Error('Agent not configured')
    }

    this.logger.debug('Executing with agent', {taskId, type})

    switch (type) {
      case 'curate': {
        // Agent uses its default session (Single-Session pattern)
        return this.curateExecutor.executeWithAgent(this.agent, {
          clientCwd: input.clientCwd,
          content,
          files: input.files,
          taskId,
        })
      }

      case 'query': {
        // Agent uses its default session (Single-Session pattern)
        return this.queryExecutor.executeWithAgent(this.agent, {query: content, taskId})
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
