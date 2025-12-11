import {EventEmitter} from 'node:events'

import type {Execution, ToolCall} from '../storage/agent-storage.js'

import {closeAgentStorage, getAgentStorage, getAgentStorageSync} from '../storage/agent-storage.js'

// ==================== TYPES ====================

export interface QueueStats {
  completed: number
  failed: number
  queued: number
  running: number
  total: number
}

export interface ExecutionWithToolCalls {
  execution: Execution
  toolCalls: ToolCall[]
}

export interface QueueSnapshot {
  recentExecutions: Execution[]
  runningExecutions: ExecutionWithToolCalls[]
  stats: QueueStats
  timestamp: number
}

// ==================== EVENTS ====================

export type QueueEventType =
  | 'error'
  | 'execution:completed'
  | 'execution:failed'
  | 'execution:started'
  | 'snapshot'
  | 'stats:updated'
  | 'stopped'

export interface QueueEvents {
  error: (error: Error) => void
  'execution:completed': (execution: Execution) => void
  'execution:failed': (execution: Execution) => void
  'execution:started': (execution: Execution) => void
  snapshot: (snapshot: QueueSnapshot) => void
  'stats:updated': (stats: QueueStats) => void
  stopped: () => void
}

// ==================== SERVICE ====================

/**
 * QueuePollingService - Singleton service that polls agent.db and emits events
 *
 * Architecture:
 * - Polls database at configurable interval (default 500ms)
 * - Compares snapshots to detect changes
 * - Emits granular events for UI updates
 * - Singleton pattern prevents memory leaks from multiple instances
 *
 * Events:
 * - 'snapshot': Full queue snapshot (for initial render)
 * - 'stats:updated': Queue statistics changed
 * - 'execution:started': New execution started
 * - 'execution:completed': Execution completed successfully
 * - 'execution:failed': Execution failed
 * - 'error': Polling error occurred
 * - 'stopped': Service stopped
 */
// eslint-disable-next-line unicorn/prefer-event-target -- EventEmitter better for Node.js typed events
export class QueuePollingService extends EventEmitter {
  private initialized = false
  private lastSnapshot: null | QueueSnapshot = null
  private pollInterval: number
  private pollTimer: NodeJS.Timeout | null = null
  private running = false
  private seenExecutionIds = new Set<string>()

  constructor(options?: {pollInterval?: number}) {
    super()
    this.pollInterval = options?.pollInterval ?? 500
  }

  /**
   * Get current snapshot without polling
   */
  getCurrentSnapshot(): null | QueueSnapshot {
    return this.lastSnapshot
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Set poll interval (takes effect on next poll)
   */
  setPollInterval(ms: number): void {
    this.pollInterval = ms
  }

  /**
   * Start polling
   */
  async start(): Promise<void> {
    if (this.running) return

    try {
      // Initialize storage (auto-detects .brv/blobs from cwd)
      await getAgentStorage()
      this.initialized = true
      this.running = true

      // Initial poll
      await this.poll()

      // Start poll loop
      this.schedulePoll()
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Stop polling
   */
  stop(): void {
    this.running = false

    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }

    if (this.initialized) {
      closeAgentStorage()
      this.initialized = false
    }

    this.emit('stopped')
  }

  // ==================== PRIVATE ====================

  /**
   * Build current snapshot from database
   */
  private buildSnapshot(): QueueSnapshot {
    const storage = getAgentStorageSync()

    const queued = storage.getQueuedExecutions()
    const running = storage.getRunningExecutions()
    const recent = storage.getRecentExecutions(20)

    // Get all running executions with their tool calls
    const runningExecutions: ExecutionWithToolCalls[] = running.map((exec) => ({
      execution: exec,
      toolCalls: storage.getToolCalls(exec.id),
    }))

    // Calculate stats
    const stats: QueueStats = {
      completed: recent.filter((e) => e.status === 'completed').length,
      failed: recent.filter((e) => e.status === 'failed').length,
      queued: queued.length,
      running: running.length,
      total: recent.length,
    }

    return {
      recentExecutions: recent,
      runningExecutions,
      stats,
      timestamp: Date.now(),
    }
  }

  /**
   * Detect changes and emit appropriate events
   */
  private detectChangesAndEmit(oldSnapshot: null | QueueSnapshot, newSnapshot: QueueSnapshot): void {
    // Always emit snapshot for subscribers that want full state
    this.emit('snapshot', newSnapshot)

    // Detect stats changes
    if (!oldSnapshot || !this.statsEqual(oldSnapshot.stats, newSnapshot.stats)) {
      this.emit('stats:updated', newSnapshot.stats)
    }

    // Detect execution state changes
    for (const exec of newSnapshot.recentExecutions) {
      const wasSeenBefore = this.seenExecutionIds.has(exec.id)

      if (wasSeenBefore) {
        // Check if status changed
        const oldExec = oldSnapshot?.recentExecutions.find((e) => e.id === exec.id)
        if (oldExec && oldExec.status !== exec.status) {
          if (exec.status === 'completed') {
            this.emit('execution:completed', exec)
          } else if (exec.status === 'failed') {
            this.emit('execution:failed', exec)
          }
        }
      } else {
        this.seenExecutionIds.add(exec.id)

        if (exec.status === 'running') {
          this.emit('execution:started', exec)
        }
      }
    }

    // Limit seen IDs to prevent memory growth
    if (this.seenExecutionIds.size > 1000) {
      const idsToKeep = new Set(newSnapshot.recentExecutions.map((e) => e.id))
      this.seenExecutionIds = idsToKeep
    }
  }

  /**
   * Single poll iteration
   */
  private async poll(): Promise<void> {
    if (!this.running || !this.initialized) return

    try {
      const newSnapshot = this.buildSnapshot()
      this.detectChangesAndEmit(this.lastSnapshot, newSnapshot)
      this.lastSnapshot = newSnapshot
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Schedule next poll
   */
  private schedulePoll(): void {
    if (!this.running) return

    this.pollTimer = setTimeout(async () => {
      await this.poll()
      this.schedulePoll()
    }, this.pollInterval)
  }

  /**
   * Compare two stats objects for equality
   */
  private statsEqual(a: QueueStats, b: QueueStats): boolean {
    return (
      a.queued === b.queued &&
      a.running === b.running &&
      a.completed === b.completed &&
      a.failed === b.failed &&
      a.total === b.total
    )
  }
}

// ==================== SINGLETON ====================

let instance: null | QueuePollingService = null

/**
 * Get singleton QueuePollingService instance
 */
export function getQueuePollingService(options?: {pollInterval?: number}): QueuePollingService {
  if (!instance) {
    instance = new QueuePollingService(options)
  }

  return instance
}

/**
 * Stop and clear singleton instance
 */
export function stopQueuePollingService(): void {
  if (instance) {
    instance.stop()
    instance = null
  }
}
