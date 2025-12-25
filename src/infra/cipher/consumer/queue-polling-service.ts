// TODO(v0.5.0): Remove this file. QueuePollingService is replaced by Transport events.

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
  /** All executions for the current session (with tool calls) - ordered by created_at ASC */
  sessionExecutions: ExecutionWithToolCalls[]
  stats: QueueStats
  timestamp: number
}

// ==================== EVENTS ====================

export type QueueEventType =
  | 'error'
  | 'execution:completed'
  | 'execution:failed'
  | 'execution:started'
  | 'reconnected'
  | 'snapshot'
  | 'stats:updated'
  | 'stopped'

export interface QueueEvents {
  error: (error: Error) => void
  'execution:completed': (execution: Execution) => void
  'execution:failed': (execution: Execution) => void
  'execution:started': (execution: Execution) => void
  reconnected: () => void
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
  private consumerId?: string
  private initialized = false
  private lastSnapshot: null | QueueSnapshot = null
  private pollInterval: number
  private pollTimer: NodeJS.Timeout | null = null
  private running = false
  private seenExecutionIds = new Set<string>()

  constructor(options?: {consumerId?: string; pollInterval?: number}) {
    super()
    this.consumerId = options?.consumerId
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
   * Set consumer ID for session-based execution history
   * Takes effect on next poll cycle
   */
  setConsumerId(consumerId: string | undefined): void {
    this.consumerId = consumerId
    // Clear last snapshot to force fresh data with new consumer
    this.lastSnapshot = null
    this.seenExecutionIds.clear()
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

    // Get session executions with tool calls (if consumerId is set)
    let sessionExecutions: ExecutionWithToolCalls[] = []
    if (this.consumerId) {
      const sessionExecs = storage.getSessionExecutions(this.consumerId)
      sessionExecutions = sessionExecs.map((exec) => ({
        execution: exec,
        toolCalls: storage.getToolCalls(exec.id),
      }))
    }

    // Get stats directly from DB (accurate counts)
    const stats = storage.getStats()

    return {
      sessionExecutions,
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
    const executions = newSnapshot.sessionExecutions.map((e) => e.execution)

    for (const exec of executions) {
      const wasSeenBefore = this.seenExecutionIds.has(exec.id)

      if (wasSeenBefore) {
        // Check if status changed
        const oldExecs = oldSnapshot?.sessionExecutions.map((e) => e.execution) ?? []
        const oldExec = oldExecs.find((e) => e.id === exec.id)
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
      const idsToKeep = new Set(executions.map((e) => e.id))
      this.seenExecutionIds = idsToKeep
    }
  }

  /**
   * Single poll iteration
   */
  private async poll(): Promise<void> {
    if (!this.running || !this.initialized) return

    try {
      // Check if DB file was replaced (e.g., by brv init in another terminal)
      const storage = getAgentStorageSync()
      if (storage.isDbFileChanged()) {
        // DB file was replaced - reconnect
        await storage.reconnect()
        // Clear seen IDs since DB was reset
        this.seenExecutionIds.clear()
        this.lastSnapshot = null
        this.emit('reconnected')
      }

      const newSnapshot = this.buildSnapshot()
      this.detectChangesAndEmit(this.lastSnapshot, newSnapshot)
      this.lastSnapshot = newSnapshot
    } catch (error) {
      // If stop() was called during poll, silently exit - this is expected during shutdown
      if (!this.running) return

      // Try to recover from errors (connection lost, storage closed, etc.)
      try {
        // Use getAgentStorage() which auto-reinitializes if singleton was closed
        const storage = await getAgentStorage()
        await storage.reconnect()
        this.seenExecutionIds.clear()
        this.lastSnapshot = null
        this.emit('reconnected')
      } catch {
        // Reconnect failed - only emit error if still running (not during intentional shutdown)
        if (this.running) {
          this.emit('error', error instanceof Error ? error : new Error(String(error)))
        }
      }
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
 * @param options - Configuration options
 * @param options.consumerId - Optional consumer identifier
 * @param options.pollInterval - Optional poll interval in milliseconds
 */
export function getQueuePollingService(options?: {consumerId?: string; pollInterval?: number}): QueuePollingService {
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
