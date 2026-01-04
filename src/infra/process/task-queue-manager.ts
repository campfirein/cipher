/**
 * TaskQueueManager - Manages in-memory task queues with concurrency control.
 *
 * Features:
 * - Separate queues for different task types (curate, query)
 * - Configurable concurrency limits per queue
 * - Task deduplication (same taskId can't be queued twice)
 * - Cancel tasks from queue before processing
 * - FIFO processing order
 *
 * This class is extracted from agent-worker.ts to enable unit testing.
 */

import type { TaskExecute } from '../../core/domain/transport/schemas.js'

import { CURATE_MAX_CONCURRENT } from './constants.js'

export type TaskType = 'curate' | 'query'

export interface QueueConfig {
  /** Maximum concurrent tasks for this queue */
  maxConcurrent: number
}

export interface TaskQueueStats {
  /** Number of tasks currently being processed */
  active: number
  /** Maximum concurrent tasks allowed */
  maxConcurrent: number
  /** Number of tasks waiting in queue */
  queued: number
}

export interface TaskQueueManagerConfig {
  curate: QueueConfig
  /** Optional callback for executor errors (for logging/debugging) */
  onExecutorError?: (taskId: string, error: unknown) => void
  query: QueueConfig
}

/**
 * Result of attempting to enqueue a task.
 */
export type EnqueueResult = { position: number; success: true } | { reason: 'duplicate' | 'unknown_type'; success: false }

/**
 * Result of attempting to cancel a task.
 */
export type CancelResult =
  | { reason: 'not_found'; success: false }
  | { success: true; taskType: TaskType; wasQueued: boolean }

/**
 * Callback for when a task should be executed.
 */
export type TaskExecutor = (task: TaskExecute) => Promise<void>

export class TaskQueueManager {
  private activeCurateTasks = 0
  private activeQueryTasks = 0
  private readonly config: Omit<TaskQueueManagerConfig, 'onExecutorError'> & { curate: QueueConfig; query: QueueConfig }
  private readonly curateQueue: TaskExecute[] = []
  /** Maps taskId → taskType for tracking (replaces Set for type awareness) */
  private readonly knownTasks = new Map<string, TaskType>()
  private readonly onExecutorError?: (taskId: string, error: unknown) => void
  private readonly queryQueue: TaskExecute[] = []
  private taskExecutor: TaskExecutor | undefined

  constructor(config?: Partial<TaskQueueManagerConfig>) {
    this.config = {
      curate: { maxConcurrent: config?.curate?.maxConcurrent ?? CURATE_MAX_CONCURRENT },
      // Query tasks are unlimited (Infinity) - lightweight and fast
      query: { maxConcurrent: config?.query?.maxConcurrent ?? Infinity },
    }
    this.onExecutorError = config?.onExecutorError
  }

  /**
   * Cancel a task by taskId.
   * Removes from queue if waiting, or marks for cancellation if processing.
   */
  cancel(taskId: string): CancelResult {
    // Try to remove from curate queue
    const curateIndex = this.curateQueue.findIndex((t) => t.taskId === taskId)
    if (curateIndex !== -1) {
      this.curateQueue.splice(curateIndex, 1)
      this.knownTasks.delete(taskId)
      return { success: true, taskType: 'curate', wasQueued: true }
    }

    // Try to remove from query queue
    const queryIndex = this.queryQueue.findIndex((t) => t.taskId === taskId)
    if (queryIndex !== -1) {
      this.queryQueue.splice(queryIndex, 1)
      this.knownTasks.delete(taskId)
      return { success: true, taskType: 'query', wasQueued: true }
    }

    // Check if task is currently processing - now we know the real taskType!
    const taskType = this.knownTasks.get(taskId)
    if (taskType) {
      // Task is processing - caller should handle cancellation via taskProcessor
      return { success: true, taskType, wasQueued: false }
    }

    return { reason: 'not_found', success: false }
  }

  /**
   * Clear all queues and reset state.
   * Useful for testing or shutdown.
   */
  clear(): void {
    this.curateQueue.length = 0
    this.queryQueue.length = 0
    this.activeCurateTasks = 0
    this.activeQueryTasks = 0
    this.knownTasks.clear()
  }

  /**
   * Enqueue a task for processing.
   * Returns success with queue position, or failure reason.
   */
  enqueue(task: TaskExecute): EnqueueResult {
    // Deduplication check
    if (this.knownTasks.has(task.taskId)) {
      return { reason: 'duplicate', success: false }
    }

    // Validate task type
    if (task.type !== 'curate' && task.type !== 'query') {
      return { reason: 'unknown_type', success: false }
    }

    // Register with type and enqueue
    this.knownTasks.set(task.taskId, task.type)

    if (task.type === 'curate') {
      this.curateQueue.push(task)
      this.tryProcessNext('curate')
      return { position: this.curateQueue.length, success: true }
    }

    this.queryQueue.push(task)
    this.tryProcessNext('query')
    return { position: this.queryQueue.length, success: true }
  }

  /**
   * Get all queue statistics.
   */
  getAllStats(): Record<TaskType, TaskQueueStats> {
    return {
      curate: this.getStats('curate'),
      query: this.getStats('query'),
    }
  }

  /**
   * Get statistics for a specific queue.
   */
  getStats(type: TaskType): TaskQueueStats {
    if (type === 'curate') {
      return {
        active: this.activeCurateTasks,
        maxConcurrent: this.config.curate.maxConcurrent,
        queued: this.curateQueue.length,
      }
    }

    return {
      active: this.activeQueryTasks,
      maxConcurrent: this.config.query.maxConcurrent,
      queued: this.queryQueue.length,
    }
  }

  /**
   * Check if the task executor has been set.
   * Useful for diagnostic logging to detect queue stalls.
   */
  hasExecutor(): boolean {
    return this.taskExecutor !== undefined
  }

  /**
   * Check if a taskId is known (queued or processing).
   */
  isKnown(taskId: string): boolean {
    return this.knownTasks.has(taskId)
  }


  /**
   * Mark a task as completed (removes from known map).
   * Should be called by executor when task finishes.
   * Guards against underflow from duplicate/invalid calls.
   */
  markCompleted(taskId: string, type: TaskType): void {
    // Guard: only decrement if task was actually known (prevents underflow)
    if (!this.knownTasks.has(taskId)) {
      return
    }

    this.knownTasks.delete(taskId)

    if (type === 'curate') {
      if (this.activeCurateTasks > 0) {
        this.activeCurateTasks--
      }

      this.tryProcessNext('curate')
    } else {
      if (this.activeQueryTasks > 0) {
        this.activeQueryTasks--
      }

      this.tryProcessNext('query')
    }
  }

  /**
   * Set the task executor callback.
   * Called when a task is ready to be processed.
   * Also triggers processing of any queued tasks (up to maxConcurrent).
   */
  setExecutor(executor: TaskExecutor): void {
    this.taskExecutor = executor
    // Process any tasks that were queued before executor was set
    // Use queue length as upper bound to handle Infinity maxConcurrent safely
    this.drainQueue('curate')
    this.drainQueue('query')
  }

  /**
   * Process all possible tasks from a queue (up to maxConcurrent).
   * Handles Infinity maxConcurrent safely by using queue length as bound.
   */
  private drainQueue(type: TaskType): void {
    const state = this.getQueueState(type)
    // Process up to queue length (safe for Infinity maxConcurrent)
    const toProcess = Math.min(state.queue.length, state.config.maxConcurrent)
    for (let i = 0; i < toProcess; i++) {
      this.tryProcessNext(type)
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private executeTask(task: TaskExecute, type: TaskType): void {
    this.taskExecutor!(task)
      .catch((error: unknown) => {
        // Notify caller of executor error (for logging/debugging)
        // Primary error handling is executor's responsibility
        this.onExecutorError?.(task.taskId, error)
      })
      .finally(() => {
        this.markCompleted(task.taskId, type)
      })
  }

  /**
   * Get queue state for a task type (DRY helper).
   */
  private getQueueState(type: TaskType): {
    active: number
    config: QueueConfig
    incrementActive: () => void
    queue: TaskExecute[]
  } {
    if (type === 'curate') {
      return {
        active: this.activeCurateTasks,
        config: this.config.curate,
        incrementActive: () => this.activeCurateTasks++,
        queue: this.curateQueue,
      }
    }

    return {
      active: this.activeQueryTasks,
      config: this.config.query,
      incrementActive: () => this.activeQueryTasks++,
      queue: this.queryQueue,
    }
  }

  /**
   * Try to process the next task from a specific queue.
   * Unified method replacing tryProcessNextCurate/tryProcessNextQuery.
   */
  private tryProcessNext(type: TaskType): void {
    // Don't process without executor - tasks stay in queue
    if (!this.taskExecutor) {
      return
    }

    const state = this.getQueueState(type)

    if (state.active >= state.config.maxConcurrent) {
      return
    }

    if (state.queue.length === 0) {
      return
    }

    const task = state.queue.shift()!
    state.incrementActive()
    this.executeTask(task, type)
  }
}
