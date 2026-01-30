/**
 * Tool Invocation Queue System
 *
 * Manages queuing and execution of tool invocations with:
 * - Priority-based ordering
 * - Concurrent execution with configurable limits
 * - Queue state management
 * - Batch execution support
 */

import type {ToolInvocation, ToolInvocationResult} from './tool-invocation.js'

import {ToolInvocationStatus} from './tool-invocation.js'

/**
 * Priority levels for tool invocations
 */
export enum ToolInvocationPriority {
  /**
   * Critical priority - Execute immediately
   */
  CRITICAL = 'CRITICAL',

  /**
   * High priority - Execute before normal
   */
  HIGH = 'HIGH',

  /**
   * Low priority - Execute after normal
   */
  LOW = 'LOW',

  /**
   * Normal priority - Default priority
   */
  NORMAL = 'NORMAL',
}

/**
 * Priority ordering for queue sorting
 */
const PRIORITY_ORDER: Record<ToolInvocationPriority, number> = {
  [ToolInvocationPriority.CRITICAL]: 0,
  [ToolInvocationPriority.HIGH]: 1,
  [ToolInvocationPriority.LOW]: 3,
  [ToolInvocationPriority.NORMAL]: 2,
}

/**
 * Queued invocation with priority and metadata
 */
export interface QueuedInvocation {
  /**
   * The tool invocation
   */
  invocation: ToolInvocation

  /**
   * Priority level
   */
  priority: ToolInvocationPriority

  /**
   * Timestamp when queued
   */
  queuedAt: number
}

/**
 * Configuration for queue execution
 */
export interface QueueExecutionConfig {
  /**
   * Maximum number of concurrent executions
   * @default 5
   */
  maxConcurrent?: number

  /**
   * Whether to stop on first error
   * @default false
   */
  stopOnError?: boolean
}

/**
 * Result from queue execution
 */
export interface QueueExecutionResult {
  /**
   * Number of completed executions
   */
  completed: number

  /**
   * Duration of queue execution in milliseconds
   */
  durationMs: number

  /**
   * Number of failed executions
   */
  failed: number

  /**
   * Individual invocation results
   */
  results: Map<string, ToolInvocationResult>

  /**
   * Number of skipped executions (due to stopOnError)
   */
  skipped: number
}

/**
 * Default execution configuration
 */
export const DEFAULT_QUEUE_EXECUTION_CONFIG: Required<QueueExecutionConfig> = {
  maxConcurrent: 5,
  stopOnError: false,
}

/**
 * Tool invocation queue for managing concurrent tool execution
 *
 * Features:
 * - Priority-based ordering
 * - Configurable concurrency limits
 * - Batch execution with error handling
 * - Queue state management
 */
export class ToolInvocationQueue {
  /**
   * Execution configuration
   */
  private readonly config: Required<QueueExecutionConfig>
  /**
   * Currently executing invocations
   */
  private readonly executing: Map<string, ToolInvocation> = new Map()
  /**
   * Queue of pending invocations
   */
  private readonly queue: QueuedInvocation[] = []

  /**
   * Create a new tool invocation queue
   *
   * @param config - Execution configuration
   */
  constructor(config?: QueueExecutionConfig) {
    this.config = {
      ...DEFAULT_QUEUE_EXECUTION_CONFIG,
      ...config,
    }
  }

  /**
   * Add an invocation to the queue
   *
   * @param invocation - Tool invocation to queue
   * @param priority - Priority level (default: NORMAL)
   * @returns True if added, false if already queued
   */
  add(invocation: ToolInvocation, priority: ToolInvocationPriority = ToolInvocationPriority.NORMAL): boolean {
    // Check if already queued or executing
    if (this.isQueued(invocation.id) || this.executing.has(invocation.id)) {
      return false
    }

    // Add to queue
    this.queue.push({
      invocation,
      priority,
      queuedAt: Date.now(),
    })

    // Sort queue by priority
    this.sortQueue()

    return true
  }

  /**
   * Add multiple invocations to the queue
   *
   * @param invocations - Array of invocations with optional priority
   * @returns Number of invocations added
   */
  addBatch(invocations: Array<{invocation: ToolInvocation; priority?: ToolInvocationPriority}>): number {
    let added = 0

    for (const {invocation, priority} of invocations) {
      if (this.add(invocation, priority)) {
        added++
      }
    }

    return added
  }

  /**
   * Clear all queued invocations
   *
   * Does not affect currently executing invocations.
   * For autonomous mode, invocations are simply removed without status change.
   *
   * @returns Number of invocations cleared
   */
  clear(): number {
    const count = this.queue.length

    // Simply clear the queue (no status change needed for autonomous mode)
    this.queue.length = 0

    return count
  }

  /**
   * Execute all queued invocations
   *
   * Executes invocations with concurrency limit and priority ordering.
   *
   * @returns Execution result with stats and individual results
   */
  async execute(): Promise<QueueExecutionResult> {
    const startTime = Date.now()
    const results = new Map<string, ToolInvocationResult>()

    let completed = 0
    let failed = 0
    let skipped = 0
    let shouldStop = false

    // Execute in batches based on concurrency limit
    while (this.queue.length > 0 && !shouldStop) {
      // Take up to maxConcurrent invocations from queue
      const batch = this.queue.splice(0, this.config.maxConcurrent)

      // Mark as executing
      for (const {invocation} of batch) {
        this.executing.set(invocation.id, invocation)
      }

      // Execute batch concurrently
      // eslint-disable-next-line no-await-in-loop
      const batchResults = await Promise.all(
        batch.map(async ({invocation}) => {
          const result = await invocation.execute()
          this.executing.delete(invocation.id)
          return {invocationId: invocation.id, result}
        }),
      )

      // Process batch results
      for (const {invocationId, result} of batchResults) {
        results.set(invocationId, result)

        if (result.status === ToolInvocationStatus.COMPLETED) {
          completed++
        } else if (result.status === ToolInvocationStatus.ERROR) {
          failed++

          // Stop on error if configured
          if (this.config.stopOnError) {
            shouldStop = true
            break
          }
        }
      }
    }

    // Count skipped invocations (remaining in queue when stopOnError triggered)
    if (shouldStop) {
      skipped = this.queue.length

      // Simply clear remaining (no status change needed for autonomous mode)
      this.queue.length = 0
    }

    return {
      completed,
      durationMs: Date.now() - startTime,
      failed,
      results,
      skipped,
    }
  }

  /**
   * Get number of currently executing invocations
   */
  getExecutingCount(): number {
    return this.executing.size
  }

  /**
   * Get number of queued invocations
   */
  getQueuedCount(): number {
    return this.queue.length
  }

  /**
   * Check if invocation is queued
   *
   * @param invocationId - ID to check
   * @returns True if queued
   */
  isQueued(invocationId: string): boolean {
    return this.queue.some((q) => q.invocation.id === invocationId)
  }

  /**
   * Peek at next invocation without removing it
   *
   * @returns Next invocation or undefined if queue is empty
   */
  peek(): ToolInvocation | undefined {
    return this.queue[0]?.invocation
  }

  /**
   * Remove a queued invocation from the queue.
   *
   * For autonomous mode, invocations are simply removed without status change.
   * The invocation remains in SCHEDULED state but will not be executed.
   *
   * @param invocationId - ID of invocation to remove
   * @returns True if removed, false if not found
   */
  remove(invocationId: string): boolean {
    // Find in queue
    const index = this.queue.findIndex((q) => q.invocation.id === invocationId)

    if (index === -1) {
      return false
    }

    // Remove from queue (no status change needed for autonomous mode)
    this.queue.splice(index, 1)

    return true
  }

  /**
   * Sort queue by priority and queue time
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      // First sort by priority
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]

      if (priorityDiff !== 0) {
        return priorityDiff
      }

      // Then by queue time (FIFO within same priority)
      return a.queuedAt - b.queuedAt
    })
  }
}
