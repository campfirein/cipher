import type {TaskExecute} from '../../core/domain/transport/schemas.js'

type QueuedTask = {
  readonly enqueuedAt: number
  readonly task: TaskExecute
}

type ProjectTaskQueueOptions = {
  log?: (message: string) => void
}

/**
 * Per-project FIFO task queue for the daemon agent pool.
 *
 * Each project gets its own queue. Tasks are dequeued one at a time
 * per project (agents execute sequentially within a project).
 * Cross-project tasks execute in parallel.
 *
 * The pool coordinates which project queues to drain based on
 * agent availability and LRU eviction policy.
 *
 * Not persisted: daemon restart clears all queues.
 * Clients reconnect and re-submit tasks.
 */
export class ProjectTaskQueue {
  private readonly log: (message: string) => void
  private readonly queues: Map<string, QueuedTask[]> = new Map()

  constructor(options?: ProjectTaskQueueOptions) {
    this.log = options?.log ?? (() => {})
  }

  /**
   * Cancel a task by taskId across all projects.
   * @returns true if the task was found and removed
   */
  cancel(taskId: string): boolean {
    for (const [projectPath, queue] of this.queues) {
      const index = queue.findIndex((q) => q.task.taskId === taskId)
      if (index !== -1) {
        queue.splice(index, 1)
        if (queue.length === 0) this.queues.delete(projectPath)
        this.log(`Cancelled queued task ${taskId} from ${projectPath}`)
        return true
      }
    }

    return false
  }

  /**
   * Clear all queues.
   */
  clear(): void {
    this.queues.clear()
  }

  /**
   * Dequeue the next task for a project.
   * @returns The next task or undefined if queue is empty
   */
  dequeue(projectPath: string): TaskExecute | undefined {
    const queue = this.queues.get(projectPath)
    if (!queue || queue.length === 0) return undefined

    const item = queue.shift()
    if (queue.length === 0) {
      this.queues.delete(projectPath)
    }

    return item?.task
  }

  /**
   * Enqueue a task for a project.
   * @returns Queue position (1-based), or -1 if taskId already queued (dedup)
   */
  enqueue(projectPath: string, task: TaskExecute): number {
    let queue = this.queues.get(projectPath)
    if (!queue) {
      queue = []
      this.queues.set(projectPath, queue)
    }

    // Dedup: reject if taskId already in queue
    if (queue.some((q) => q.task.taskId === task.taskId)) {
      this.log(`Task ${task.taskId} already queued for ${projectPath}`)
      return -1
    }

    queue.push({enqueuedAt: Date.now(), task})
    this.log(`Task ${task.taskId} queued for ${projectPath} (position=${queue.length})`)
    return queue.length
  }

  /**
   * Get all projects that have queued tasks.
   */
  getProjectsWithTasks(): string[] {
    const result: string[] = []
    for (const [projectPath, queue] of this.queues) {
      if (queue.length > 0) result.push(projectPath)
    }

    return result
  }

  /**
   * Get the number of queued tasks for a project.
   */
  getQueueLength(projectPath: string): number {
    return this.queues.get(projectPath)?.length ?? 0
  }

  /**
   * Check if any project has waiting tasks.
   */
  hasWaitingTasks(): boolean {
    for (const queue of this.queues.values()) {
      if (queue.length > 0) return true
    }

    return false
  }
}
