import type {
  Execution,
  ExecutionStatus,
  ExecutionType,
  ToolCall,
  ToolCallInfo,
  ToolCallStatus,
  ToolCallUpdateOptions,
} from '../../domain/cipher/queue/types.js'

/**
 * Interface for agent execution storage.
 *
 * Manages the execution queue, tool call tracking, and consumer locks.
 * Implementations can use different storage backends (SQLite, in-memory, etc.)
 */
export interface IAgentStorage {
  /**
   * Acquire consumer lock (register this consumer).
   * Only ONE consumer can run at a time.
   * @param consumerId - Unique ID for this consumer
   * @returns true if lock acquired, false if another consumer is already running
   */
  acquireConsumerLock(consumerId: string): boolean

  /**
   * Add a tool call record.
   * @returns tool call id
   */
  addToolCall(executionId: string, info: ToolCallInfo): string

  /**
   * Cleanup old executions, keep only maxKeep most recent completed/failed.
   * @returns number of deleted executions
   */
  cleanupOldExecutions(maxKeep?: number): number

  /**
   * Cleanup orphaned executions (status='running') from previous session crash.
   * @returns number of orphaned executions
   */
  cleanupOrphanedExecutions(): number

  /**
   * Cleanup stale consumers and orphan their executions.
   * @param timeoutMs - heartbeat timeout (default 30 seconds)
   * @returns number of orphaned executions
   */
  cleanupStaleConsumers(timeoutMs?: number): number

  /**
   * Close storage connection.
   */
  close(): void

  /**
   * Create a new execution.
   * @param type - 'curate' or 'query'
   * @param input - content (curate) or query string (query)
   * @returns execution id
   */
  createExecution(type: ExecutionType, input: string): string

  /**
   * Dequeue multiple executions at once (atomic batch SELECT + UPDATE).
   * @param limit - max number of executions to dequeue
   * @param consumerId - ID of the consumer claiming these executions
   * @returns array of executions (may be empty if queue is empty)
   */
  dequeueBatch(limit: number, consumerId?: string): Execution[]

  /**
   * Dequeue next queued execution (atomic SELECT + UPDATE).
   * @param consumerId - ID of the consumer claiming this execution
   * @returns execution or null if queue is empty
   */
  dequeueExecution(consumerId?: string): Execution | null

  /**
   * Get execution by id.
   */
  getExecution(id: string): Execution | null

  /**
   * Get executions updated since timestamp (for incremental polling).
   */
  getExecutionsSince(timestamp: number): Execution[]

  /**
   * Get execution with all its tool calls (for UI display).
   */
  getExecutionWithToolCalls(id: string): null | {execution: Execution; toolCalls: ToolCall[]}

  /**
   * Get all queued executions.
   */
  getQueuedExecutions(): Execution[]

  /**
   * Get recent executions (for UI display).
   */
  getRecentExecutions(limit?: number): Execution[]

  /**
   * Get all running executions.
   */
  getRunningExecutions(): Execution[]

  /**
   * Get queue statistics (queries DB directly for accurate counts).
   */
  getStats(): {completed: number; failed: number; queued: number; running: number; total: number}

  /**
   * Get all tool calls for an execution.
   */
  getToolCalls(executionId: string): ToolCall[]

  /**
   * Check if any consumer is currently active (has recent heartbeat).
   * @param timeoutMs - heartbeat timeout (default 30 seconds)
   */
  hasActiveConsumer(timeoutMs?: number): boolean

  /**
   * Check if a specific consumer lock exists in the database.
   * Used by Consumer to verify its lock is still valid after DB reconnection.
   */
  hasConsumerLock(consumerId: string): boolean

  /**
   * Initialize storage.
   */
  initialize(options?: {cleanupOrphans?: boolean}): Promise<void>

  /** Whether the storage has been initialized */
  readonly initialized: boolean

  /**
   * Check if the DB file has been replaced (different inode).
   * Returns true if DB needs reconnection.
   */
  isDbFileChanged(): boolean

  /**
   * Reconnect to the database (close and reinitialize).
   * Use when DB file has been replaced by another process (e.g., brv init).
   */
  reconnect(): Promise<void>

  /**
   * Release consumer lock (unregister this consumer).
   */
  releaseConsumerLock(consumerId: string): void

  /**
   * Update consumer heartbeat.
   */
  updateConsumerHeartbeat(consumerId: string): void

  /**
   * Update execution status.
   */
  updateExecutionStatus(id: string, status: ExecutionStatus, result?: string, error?: string): void

  /**
   * Update tool call status and result.
   */
  updateToolCall(id: string, status: ToolCallStatus, options?: ToolCallUpdateOptions): void
}
