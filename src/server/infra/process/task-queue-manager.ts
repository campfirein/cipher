/**
 * TaskQueueManager - Manages in-memory task queue with FIFO sequential execution.
 *
 * Features:
 * - Unified queue for all task types (curate, query)
 * - Configurable concurrency limit (default: 1 for sequential execution)
 * - Task deduplication (same taskId can't be queued twice)
 * - Cancel tasks from queue before processing
 * - Strict FIFO processing order across all task types
 *
 * This class is extracted from agent-worker.ts to enable unit testing.
 */

import type {TaskExecute, TaskType} from '../../core/domain/transport/schemas.js'

import {isValidTaskType} from '../../utils/type-guards.js'

// Re-export TaskType for backward compatibility (unicorn/prefer-export-from)
export type {TaskType} from '../../core/domain/transport/schemas.js'

export interface TaskQueueStats {
  /** Number of tasks currently being processed */
  active: number
  /** Maximum concurrent tasks allowed */
  maxConcurrent: number
  /** Number of tasks waiting in queue */
  queued: number
}

export interface TaskQueueManagerConfig {
  /** Maximum concurrent tasks (default: 1 for sequential execution) */
  maxConcurrent?: number
  /** Optional callback for executor errors (for logging/debugging) */
  onExecutorError?: (taskId: string, error: unknown) => void
}

/**
 * Result of attempting to enqueue a task.
 */
export type EnqueueResult = {position: number; success: true} | {reason: 'duplicate' | 'unknown_type'; success: false}

/**
 * Result of attempting to cancel a task.
 */
export type CancelResult =
  | {reason: 'not_found'; success: false}
  | {success: true; taskType: TaskType; wasQueued: boolean}

/**
 * Callback for when a task should be executed.
 */
export type TaskExecutor = (task: TaskExecute) => Promise<void>

export class TaskQueueManager {
  private activeTasks = 0
  /** Maps taskId → taskType for tracking (replaces Set for type awareness) */
  private readonly knownTasks = new Map<string, TaskType>()
  private readonly maxConcurrent: number
  private readonly onExecutorError?: (taskId: string, error: unknown) => void
  private readonly queue: TaskExecute[] = []
  private taskExecutor: TaskExecutor | undefined

  constructor(config?: TaskQueueManagerConfig) {
    this.maxConcurrent = config?.maxConcurrent ?? 1
    this.onExecutorError = config?.onExecutorError
  }

  /**
   * Cancel a task by taskId.
   * Removes from queue if waiting, or marks for cancellation if processing.
   */
  cancel(taskId: string): CancelResult {
    // Try to remove from queue
    const index = this.queue.findIndex((t) => t.taskId === taskId)
    if (index !== -1) {
      const task = this.queue[index]
      this.queue.splice(index, 1)
      this.knownTasks.delete(taskId)
      return {success: true, taskType: task.type, wasQueued: true}
    }

    // Check if task is currently processing - get type from knownTasks
    const taskType = this.knownTasks.get(taskId)
    if (taskType) {
      // Task is processing - caller should handle cancellation via taskProcessor
      return {success: true, taskType, wasQueued: false}
    }

    return {reason: 'not_found', success: false}
  }

  /**
   * Clear all queues and reset state.
   * Useful for testing or shutdown.
   */
  clear(): void {
    this.queue.length = 0
    this.activeTasks = 0
    this.knownTasks.clear()
  }

  /**
   * Enqueue a task for processing.
   * Returns success with queue position, or failure reason.
   */
  enqueue(task: TaskExecute): EnqueueResult {
    // Deduplication check
    if (this.knownTasks.has(task.taskId)) {
      return {reason: 'duplicate', success: false}
    }

    // Validate task type using type guard for compile-time safety
    if (!isValidTaskType(task.type)) {
      return {reason: 'unknown_type', success: false}
    }

    // Register with type and enqueue
    this.knownTasks.set(task.taskId, task.type)
    this.queue.push(task)
    this.tryProcessNext()
    return {position: this.queue.length, success: true}
  }

  /**
   * Get total active task count.
   */
  getActiveCount(): number {
    return this.activeTasks
  }

  /**
   * Get total queued task count.
   */
  getQueuedCount(): number {
    return this.queue.length
  }

  /**
   * Get a copy of all queued tasks (not including active tasks).
   * Useful for notifying clients before clearing the queue.
   */
  getQueuedTasks(): readonly TaskExecute[] {
    return [...this.queue]
  }

  /**
   * Get statistics for the queue.
   */
  getStats(): TaskQueueStats {
    return {
      active: this.activeTasks,
      maxConcurrent: this.maxConcurrent,
      queued: this.queue.length,
    }
  }

  /**
   * Check if there are any active tasks (currently being processed).
   * Used to prevent reinit during task execution.
   */
  hasActiveTasks(): boolean {
    return this.activeTasks > 0
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
  markCompleted(taskId: string): void {
    // Guard: only decrement if task was actually known (prevents underflow)
    if (!this.knownTasks.has(taskId)) {
      return
    }

    this.knownTasks.delete(taskId)

    if (this.activeTasks > 0) {
      this.activeTasks--
    }

    this.tryProcessNext()
  }

  /**
   * Set the task executor callback.
   * Called when a task is ready to be processed.
   * Also triggers processing of any queued tasks (up to maxConcurrent).
   */
  setExecutor(executor: TaskExecutor): void {
    this.taskExecutor = executor
    // Process any tasks that were queued before executor was set
    this.drainQueue()
  }

  /**
   * Process all possible tasks from the queue (up to maxConcurrent).
   */
  private drainQueue(): void {
    // Process up to maxConcurrent tasks
    const toProcess = Math.min(this.queue.length, this.maxConcurrent)
    for (let i = 0; i < toProcess; i++) {
      this.tryProcessNext()
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private executeTask(task: TaskExecute): void {
    this.taskExecutor!(task)
      .catch((error: unknown) => {
        // Notify caller of executor error (for logging/debugging)
        // Primary error handling is executor's responsibility
        this.onExecutorError?.(task.taskId, error)
      })
      .finally(() => {
        this.markCompleted(task.taskId)
      })
  }

  /**
   * Try to process the next task from the queue.
   */
  private tryProcessNext(): void {
    // Don't process without executor - tasks stay in queue
    if (!this.taskExecutor) {
      return
    }

    if (this.activeTasks >= this.maxConcurrent) {
      return
    }

    if (this.queue.length === 0) {
      return
    }

    const task = this.queue.shift()!
    this.activeTasks++
    this.executeTask(task)
  }
}
