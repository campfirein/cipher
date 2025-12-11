import type {Statement} from 'better-sqlite3'

import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import * as fsSync from 'node:fs'
import * as fs from 'node:fs/promises'
import {join} from 'node:path'

import type {
  Execution,
  ExecutionStatus,
  ExecutionType,
  ToolCall,
  ToolCallInfo,
  ToolCallStatus,
  ToolCallUpdateOptions,
} from '../../../core/domain/cipher/queue/types.js'
import type {IAgentStorage} from '../../../core/interfaces/cipher/i-agent-storage.js'

import {BLOBS_DIR, BRV_DIR} from '../../../constants.js'

// Re-export types from domain for backward compatibility
export type {
  ConsumerLock,
  Execution,
  ExecutionStatus,
  ExecutionType,
  ToolCall,
  ToolCallInfo,
  ToolCallStatus,
  ToolCallUpdateOptions,
} from '../../../core/domain/cipher/queue/types.js'

/**
 * Database row type for executions table
 */
interface ExecutionRow {
  completed_at: null | number
  created_at: number
  error: null | string
  id: string
  input: string
  result: null | string
  started_at: null | number
  status: string
  type: string
  updated_at: number
}

/**
 * Database row type for tool_calls table
 */
interface ToolCallRow {
  args: null | string
  args_summary: null | string
  chars_count: null | number
  completed_at: null | number
  description: null | string
  duration_ms: null | number
  error: null | string
  execution_id: string
  file_path: null | string
  id: string
  lines_count: null | number
  name: string
  result: null | string
  result_summary: null | string
  started_at: number
  status: string
}

// ==================== SQL SCHEMA ====================

const SCHEMA_SQL = `
-- Consumer Locks: track active consumers for orphan detection
CREATE TABLE IF NOT EXISTS consumer_locks (
  id TEXT PRIMARY KEY,
  pid INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  last_heartbeat INTEGER NOT NULL
);

-- Executions: job queue (status='queued') + execution tracking
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  input TEXT NOT NULL,
  status TEXT NOT NULL,
  consumer_id TEXT,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- Tool Calls: tool call details for UI polling
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  args TEXT,
  args_summary TEXT,
  status TEXT NOT NULL,
  result TEXT,
  result_summary TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  -- Metrics for FE display (raw int values)
  duration_ms INTEGER,
  lines_count INTEGER,
  chars_count INTEGER,
  file_path TEXT,
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_type ON executions(type);
CREATE INDEX IF NOT EXISTS idx_executions_updated ON executions(updated_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_execution ON tool_calls(execution_id);
`

// Migration SQL for existing databases (add new columns if missing)
const MIGRATION_SQL = `
-- Add new columns to tool_calls if they don't exist
ALTER TABLE tool_calls ADD COLUMN duration_ms INTEGER;
ALTER TABLE tool_calls ADD COLUMN lines_count INTEGER;
ALTER TABLE tool_calls ADD COLUMN chars_count INTEGER;
ALTER TABLE tool_calls ADD COLUMN file_path TEXT;
-- Add consumer_id to executions for orphan tracking
ALTER TABLE executions ADD COLUMN consumer_id TEXT;
`

// ==================== CLASS ====================

/**
 * AgentStorage - SQLite-based storage for execution queue and tool calls
 *
 * Features:
 * - Single database file at .brv/blobs/agent.db
 * - Job queue via executions.status = 'queued'
 * - Tool call tracking for UI polling
 * - Prepared statement caching (no memory leak)
 * - WAL mode for concurrent read/write
 * - Orphan cleanup on startup
 * - Old execution cleanup (max 100)
 */
export class AgentStorage implements IAgentStorage {
  initialized = false
  private db: Database.Database | null = null
  // Track DB file inode to detect if file was replaced
  private dbFileInode: null | number = null
  private readonly dbPath: string
  private readonly inMemory: boolean
  private stmtAddToolCall: null | Statement = null
  private stmtCleanupOrphans: null | Statement = null
  private stmtCountCompletedFailed: null | Statement = null
  // Cached prepared statements (lazy init, reuse to avoid memory leak)
  private stmtCreateExecution: null | Statement = null
  private stmtDeleteOldExecutions: null | Statement = null
  private stmtDequeueBatchSelect: null | Statement = null
  private stmtDequeueSelect: null | Statement = null
  private stmtGetExecution: null | Statement = null
  private stmtGetExecutionsSince: null | Statement = null
  private stmtGetQueuedExecutions: null | Statement = null
  private stmtGetRecentExecutions: null | Statement = null
  private stmtGetRunningExecutions: null | Statement = null
  private stmtGetToolCalls: null | Statement = null
  private stmtUpdateStatus: null | Statement = null
  private stmtUpdateToolCall: null | Statement = null
  private readonly storageDir: string

  constructor(config?: {inMemory?: boolean; storageDir?: string}) {
    this.inMemory = config?.inMemory ?? false
    this.storageDir = config?.storageDir || join(process.cwd(), BRV_DIR, BLOBS_DIR)
    this.dbPath = this.inMemory ? ':memory:' : join(this.storageDir, 'agent.db')
  }

  // ==================== LIFECYCLE ====================

  /**
   * Acquire consumer lock (register this consumer)
   * Only ONE consumer can run at a time - checks for any active consumer first
   * @returns true if lock acquired, false if another consumer is already running
   */
  acquireConsumerLock(consumerId: string): boolean {
    this.ensureInitialized()

    const now = Date.now()
    const {pid} = process

    // Use transaction to ensure atomic check-then-insert
    const acquireLock = this.getDb().transaction(() => {
      // Check if any active consumer exists (with recent heartbeat)
      const cutoff = now - 30_000 // 30 second timeout
      const existing = this.getDb().prepare(`SELECT id FROM consumer_locks WHERE last_heartbeat >= ?`).get(cutoff) as
        | undefined
        | {id: string}

      if (existing) {
        // Another consumer is active
        return false
      }

      // No active consumer - acquire lock
      this.getDb().prepare(
        `INSERT INTO consumer_locks (id, pid, started_at, last_heartbeat)
         VALUES (?, ?, ?, ?)`,
      ).run(consumerId, pid, now, now)
      return true
    })

    return acquireLock()
  }

  /**
   * Add a tool call record
   * @returns tool call id
   */
  addToolCall(executionId: string, info: ToolCallInfo): string {
    this.ensureInitialized()

    const id = randomUUID()
    const now = Date.now()

    if (!this.stmtAddToolCall) {
      this.stmtAddToolCall = this.getDb().prepare(`
        INSERT INTO tool_calls (id, execution_id, name, description, args, args_summary, file_path, status, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)
      `)
    }

    this.stmtAddToolCall.run(
      id,
      executionId,
      info.name,
      info.description ?? null,
      JSON.stringify(info.args),
      info.argsSummary ?? null,
      info.filePath ?? null,
      now,
    )

    return id
  }

  /**
   * Cleanup old executions, keep only maxKeep most recent completed/failed
   */
  cleanupOldExecutions(maxKeep: number = 100): number {
    this.ensureInitialized()

    // Count completed/failed executions
    if (!this.stmtCountCompletedFailed) {
      this.stmtCountCompletedFailed = this.getDb().prepare(`
        SELECT COUNT(*) as count FROM executions
        WHERE status IN ('completed', 'failed')
      `)
    }

    const countResult = this.stmtCountCompletedFailed.get() as {count: number}
    const toDelete = countResult.count - maxKeep

    if (toDelete <= 0) {
      return 0
    }

    // Delete oldest executions (tool_calls auto-deleted via CASCADE)
    if (!this.stmtDeleteOldExecutions) {
      this.stmtDeleteOldExecutions = this.getDb().prepare(`
        DELETE FROM executions
        WHERE id IN (
          SELECT id FROM executions
          WHERE status IN ('completed', 'failed')
          ORDER BY created_at ASC
          LIMIT ?
        )
      `)
    }

    const result = this.stmtDeleteOldExecutions.run(toDelete)
    return result.changes
  }

  /**
   * Cleanup orphaned executions (status='running') from previous session crash
   * Should be called on startup
   */
  cleanupOrphanedExecutions(): number {
    this.ensureInitialized()

    if (!this.stmtCleanupOrphans) {
      this.stmtCleanupOrphans = this.getDb().prepare(`
        UPDATE executions
        SET status = 'failed',
            error = 'Orphaned from previous session',
            updated_at = ?
        WHERE status = 'running'
      `)
    }

    const now = Date.now()
    const result = this.stmtCleanupOrphans.run(now)
    return result.changes
  }

  /**
   * Cleanup stale consumers and orphan their executions
   * A consumer is stale if its heartbeat is older than timeoutMs
   * @param timeoutMs - heartbeat timeout (default 30 seconds)
   * @returns number of orphaned executions
   */
  cleanupStaleConsumers(timeoutMs: number = 30_000): number {
    this.ensureInitialized()

    const now = Date.now()
    const cutoff = now - timeoutMs
    let totalOrphaned = 0

    // Case 1: Find consumers with stale heartbeat
    const staleConsumers = this.getDb().prepare(
      `
      SELECT id FROM consumer_locks WHERE last_heartbeat < ?
    `,
    ).all(cutoff) as Array<{id: string}>

    if (staleConsumers.length > 0) {
      // Orphan executions from stale consumers
      const orphanStmt = this.getDb().prepare(`
        UPDATE executions
        SET status = 'failed',
            error = 'Consumer died unexpectedly',
            consumer_id = NULL,
            updated_at = ?
        WHERE consumer_id = ? AND status = 'running'
      `)

      // Delete stale consumer locks
      const deleteLockStmt = this.getDb().prepare(`
        DELETE FROM consumer_locks WHERE id = ?
      `)

      for (const consumer of staleConsumers) {
        const result = orphanStmt.run(now, consumer.id)
        totalOrphaned += result.changes
        deleteLockStmt.run(consumer.id)
      }
    }

    // Case 2: Find "running" executions whose consumer_id doesn't exist in consumer_locks
    // This handles cases where consumer crashed without proper cleanup
    const orphanedFromMissingConsumers = this.getDb().prepare(`
      UPDATE executions
      SET status = 'failed',
          error = 'Consumer no longer exists',
          completed_at = ?,
          updated_at = ?
      WHERE status = 'running'
        AND consumer_id IS NOT NULL
        AND consumer_id NOT IN (SELECT id FROM consumer_locks)
    `).run(now, now)

    totalOrphaned += orphanedFromMissingConsumers.changes

    // Case 3: Find "running" CURATE executions with NULL consumer_id (orphaned from releaseConsumerLock)
    // These are stuck executions where consumer stopped but didn't complete the job
    // NOTE: Query runs inline (not via consumer), so consumer_id=NULL is normal for query
    const orphanedNullConsumer = this.getDb().prepare(`
      UPDATE executions
      SET status = 'failed',
          error = 'Execution orphaned (no consumer)',
          completed_at = ?,
          updated_at = ?
      WHERE status = 'running'
        AND consumer_id IS NULL
        AND type = 'curate'
    `).run(now, now)

    totalOrphaned += orphanedNullConsumer.changes

    return totalOrphaned
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.initialized = false

      // Clear cached statements
      this.stmtCreateExecution = null
      this.stmtDequeueBatchSelect = null
      this.stmtDequeueSelect = null
      this.stmtUpdateStatus = null
      this.stmtGetExecution = null
      this.stmtGetQueuedExecutions = null
      this.stmtGetRunningExecutions = null
      this.stmtGetRecentExecutions = null
      this.stmtAddToolCall = null
      this.stmtUpdateToolCall = null
      this.stmtGetToolCalls = null
      this.stmtCleanupOrphans = null
      this.stmtCountCompletedFailed = null
      this.stmtDeleteOldExecutions = null
      this.stmtGetExecutionsSince = null
    }
  }

  /**
   * Create a new execution
   * @param type - 'curate' or 'query'
   * @param input - content (curate) or query string (query)
   * @returns execution id
   */
  createExecution(type: ExecutionType, input: string): string {
    this.ensureInitialized()

    const id = randomUUID()
    const now = Date.now()
    // curate starts as 'queued', query starts as 'running'
    const status: ExecutionStatus = type === 'curate' ? 'queued' : 'running'
    const startedAt = type === 'query' ? now : null

    if (!this.stmtCreateExecution) {
      this.stmtCreateExecution = this.getDb().prepare(`
        INSERT INTO executions (id, type, input, status, created_at, started_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
    }

    this.stmtCreateExecution.run(id, type, input, status, now, startedAt, now)
    return id
  }

  /**
   * Dequeue multiple executions at once (atomic batch SELECT + UPDATE)
   * This is more efficient than calling dequeueExecution() multiple times
   * and ensures all queued items are seen in a single transaction snapshot
   * @param limit - max number of executions to dequeue
   * @param consumerId - ID of the consumer claiming these executions
   * @returns array of executions (may be empty if queue is empty)
   */
  dequeueBatch(limit: number, consumerId?: string): Execution[] {
    this.ensureInitialized()

    if (limit <= 0) return []

    if (!this.stmtDequeueBatchSelect) {
      // Use a parameterized LIMIT - better-sqlite3 handles this correctly
      this.stmtDequeueBatchSelect = this.getDb().prepare(`
        SELECT * FROM executions
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT ?
      `)
    }

    // Capture for type safety inside transaction closure
    const selectStmt = this.stmtDequeueBatchSelect

    // Use dynamic statement to handle optional consumer_id
    const updateSql = consumerId
      ? `UPDATE executions SET status = 'running', consumer_id = ?, started_at = ?, updated_at = ? WHERE id = ?`
      : `UPDATE executions SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`

    // Use transaction for atomicity - all SELECTs and UPDATEs in one snapshot
    const dequeueBatch = this.getDb().transaction((batchLimit: number) => {
      const rows = selectStmt.all(batchLimit) as ExecutionRow[]
      if (rows.length === 0) {
        return []
      }

      const now = Date.now()
      const executions: Execution[] = []
      const updateStmt = this.getDb().prepare(updateSql)

      for (const row of rows) {
        if (consumerId) {
          updateStmt.run(consumerId, now, now, row.id)
        } else {
          updateStmt.run(now, now, row.id)
        }

        // eslint-disable-next-line camelcase
        executions.push(this.rowToExecution({...row, started_at: now, status: 'running', updated_at: now}))
      }

      return executions
    })

    return dequeueBatch(limit)
  }

  /**
   * Dequeue next queued execution (atomic SELECT + UPDATE)
   * @param consumerId - ID of the consumer claiming this execution
   * @returns execution or null if queue is empty
   */
  dequeueExecution(consumerId?: string): Execution | null {
    this.ensureInitialized()

    if (!this.stmtDequeueSelect) {
      this.stmtDequeueSelect = this.getDb().prepare(`
        SELECT * FROM executions
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      `)
    }

    // Capture for type safety inside transaction closure
    const selectStmt = this.stmtDequeueSelect

    // Use dynamic statement to handle optional consumer_id
    const updateSql = consumerId
      ? `UPDATE executions SET status = 'running', consumer_id = ?, started_at = ?, updated_at = ? WHERE id = ?`
      : `UPDATE executions SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`

    // Use transaction for atomicity
    const dequeue = this.getDb().transaction(() => {
      const row = selectStmt.get() as ExecutionRow | undefined
      if (!row) {
        return null
      }

      const now = Date.now()
      const updateStmt = this.getDb().prepare(updateSql)
      if (consumerId) {
        updateStmt.run(consumerId, now, now, row.id)
      } else {
        updateStmt.run(now, now, row.id)
      }

      // eslint-disable-next-line camelcase
      return this.rowToExecution({...row, started_at: now, status: 'running', updated_at: now})
    })

    return dequeue()
  }

  // ==================== EXECUTION METHODS ====================

  /**
   * Get execution by id
   */
  getExecution(id: string): Execution | null {
    this.ensureInitialized()

    if (!this.stmtGetExecution) {
      this.stmtGetExecution = this.getDb().prepare(`
        SELECT * FROM executions WHERE id = ?
      `)
    }

    const row = this.stmtGetExecution.get(id) as ExecutionRow | undefined
    return row ? this.rowToExecution(row) : null
  }

  /**
   * Get executions updated since timestamp (for incremental polling)
   */
  getExecutionsSince(timestamp: number): Execution[] {
    this.ensureInitialized()

    if (!this.stmtGetExecutionsSince) {
      this.stmtGetExecutionsSince = this.getDb().prepare(`
        SELECT * FROM executions
        WHERE updated_at > ?
        ORDER BY updated_at ASC
        LIMIT 100
      `)
    }

    const rows = this.stmtGetExecutionsSince.all(timestamp) as ExecutionRow[]
    return rows.map((row) => this.rowToExecution(row))
  }

  /**
   * Get execution with all its tool calls (for UI display)
   */
  getExecutionWithToolCalls(id: string): null | {execution: Execution; toolCalls: ToolCall[]} {
    const execution = this.getExecution(id)
    if (!execution) {
      return null
    }

    const toolCalls = this.getToolCalls(id)
    return {execution, toolCalls}
  }

  /**
   * Get all queued executions
   */
  getQueuedExecutions(): Execution[] {
    this.ensureInitialized()

    if (!this.stmtGetQueuedExecutions) {
      this.stmtGetQueuedExecutions = this.getDb().prepare(`
        SELECT * FROM executions
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 100
      `)
    }

    const rows = this.stmtGetQueuedExecutions.all() as ExecutionRow[]
    return rows.map((row) => this.rowToExecution(row))
  }

  /**
   * Get recent executions (for UI display)
   */
  getRecentExecutions(limit: number = 20): Execution[] {
    this.ensureInitialized()

    if (!this.stmtGetRecentExecutions) {
      this.stmtGetRecentExecutions = this.getDb().prepare(`
        SELECT * FROM executions
        ORDER BY created_at DESC
        LIMIT ?
      `)
    }

    const rows = this.stmtGetRecentExecutions.all(limit) as ExecutionRow[]
    return rows.map((row) => this.rowToExecution(row))
  }

  /**
   * Get all running executions
   */
  getRunningExecutions(): Execution[] {
    this.ensureInitialized()

    if (!this.stmtGetRunningExecutions) {
      this.stmtGetRunningExecutions = this.getDb().prepare(`
        SELECT * FROM executions
        WHERE status = 'running'
        ORDER BY started_at ASC
        LIMIT 100
      `)
    }

    const rows = this.stmtGetRunningExecutions.all() as ExecutionRow[]
    return rows.map((row) => this.rowToExecution(row))
  }

  /**
   * Get queue statistics (queries DB directly for accurate counts)
   */
  getStats(): {completed: number; failed: number; queued: number; running: number; total: number} {
    this.ensureInitialized()

    const result = this.getDb().prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM executions
    `).get() as {completed: number; failed: number; queued: number; running: number; total: number}

    return result
  }

  /**
   * Get all tool calls for an execution
   */
  getToolCalls(executionId: string): ToolCall[] {
    this.ensureInitialized()

    if (!this.stmtGetToolCalls) {
      this.stmtGetToolCalls = this.getDb().prepare(`
        SELECT * FROM tool_calls
        WHERE execution_id = ?
        ORDER BY started_at ASC
      `)
    }

    const rows = this.stmtGetToolCalls.all(executionId) as ToolCallRow[]
    return rows.map((row) => this.rowToToolCall(row))
  }

  /**
   * Check if any consumer is currently active (has recent heartbeat)
   * @param timeoutMs - heartbeat timeout (default 30 seconds)
   */
  hasActiveConsumer(timeoutMs: number = 30_000): boolean {
    this.ensureInitialized()

    const now = Date.now()
    const cutoff = now - timeoutMs

    const result = this.getDb().prepare(
      `
      SELECT COUNT(*) as count FROM consumer_locks WHERE last_heartbeat >= ?
    `,
    ).get(cutoff) as {count: number}

    return result.count > 0
  }

  /**
   * Check if a specific consumer lock exists in the database
   * Used by Consumer to verify its lock is still valid after DB reconnection
   */
  hasConsumerLock(consumerId: string): boolean {
    this.ensureInitialized()

    const result = this.getDb().prepare(`SELECT 1 FROM consumer_locks WHERE id = ?`).get(consumerId) as undefined | {1: number}
    return result !== undefined
  }

  /**
   * Initialize storage - create tables, enable WAL
   * @param options.cleanupOrphans - If true, cleanup orphaned executions (only Consumer should set this)
   */
  async initialize(options?: {cleanupOrphans?: boolean}): Promise<void> {
    if (this.initialized) {
      return
    }

    // Ensure storage directory exists (skip for in-memory)
    if (!this.inMemory) {
      await fs.mkdir(this.storageDir, {recursive: true})
    }

    // Open/create database
    this.db = new Database(this.dbPath)

    // Enable WAL mode for better concurrent performance
    this.db.pragma('journal_mode = WAL')

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON')

    // Set busy timeout to avoid SQLITE_BUSY errors
    this.db.pragma('busy_timeout = 5000')

    // Create schema
    this.db.exec(SCHEMA_SQL)

    // Run migrations for existing databases (ignore errors for columns that already exist)
    for (const line of MIGRATION_SQL.split('\n')) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('--')) {
        try {
          this.db.exec(trimmed)
        } catch {
          // Column already exists, ignore
        }
      }
    }

    // Capture inode to detect if file is replaced later
    if (!this.inMemory) {
      try {
        const stat = fsSync.statSync(this.dbPath)
        this.dbFileInode = stat.ino
      } catch {
        // File may not exist yet, ignore
      }
    }

    this.initialized = true

    // Cleanup orphaned executions from previous session (only if requested)
    // IMPORTANT: Only Consumer should set cleanupOrphans=true
    // Dashboard/other readers should NOT cleanup, or they will mark consumer's running executions as failed
    if (options?.cleanupOrphans) {
      this.cleanupOrphanedExecutions()
    }
  }

  /**
   * Check if the DB file has been replaced (different inode)
   * Returns true if DB needs reconnection
   */
  isDbFileChanged(): boolean {
    if (this.inMemory || !this.dbFileInode) {
      return false
    }

    try {
      const stat = fsSync.statSync(this.dbPath)
      return stat.ino !== this.dbFileInode
    } catch {
      // File doesn't exist - definitely changed
      return true
    }
  }

  /**
   * Reconnect to the database (close and reinitialize)
   * Use when DB file has been replaced by another process (e.g., brv init)
   */
  async reconnect(): Promise<void> {
    // Close existing connection
    this.close()

    // Reinitialize (will create new connection and capture new inode)
    await this.initialize()
  }

  // ==================== TOOL CALL METHODS ====================

  /**
   * Release consumer lock (unregister this consumer)
   */
  releaseConsumerLock(consumerId: string): void {
    this.ensureInitialized()

    // First, clear consumer_id from any running executions
    const now = Date.now()
    this.getDb().prepare(
      `
      UPDATE executions
      SET consumer_id = NULL, updated_at = ?
      WHERE consumer_id = ? AND status = 'running'
    `,
    ).run(now, consumerId)

    // Then delete the lock
    this.getDb().prepare(
      `
      DELETE FROM consumer_locks WHERE id = ?
    `,
    ).run(consumerId)
  }

  /**
   * Update consumer heartbeat
   */
  updateConsumerHeartbeat(consumerId: string): void {
    this.ensureInitialized()

    const now = Date.now()
    this.getDb().prepare(
      `
      UPDATE consumer_locks SET last_heartbeat = ? WHERE id = ?
    `,
    ).run(now, consumerId)
  }

  /**
   * Update execution status
   */
  updateExecutionStatus(id: string, status: ExecutionStatus, result?: string, error?: string): void {
    this.ensureInitialized()

    if (!this.stmtUpdateStatus) {
      this.stmtUpdateStatus = this.getDb().prepare(`
        UPDATE executions
        SET status = ?, result = ?, error = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
      `)
    }

    const now = Date.now()
    const completedAt = status === 'completed' || status === 'failed' ? now : null
    this.stmtUpdateStatus.run(status, result ?? null, error ?? null, completedAt, now, id)
  }

  /**
   * Update tool call status and result
   */
  updateToolCall(id: string, status: ToolCallStatus, options?: ToolCallUpdateOptions): void {
    this.ensureInitialized()

    if (!this.stmtUpdateToolCall) {
      this.stmtUpdateToolCall = this.getDb().prepare(`
        UPDATE tool_calls
        SET status = ?, result = ?, result_summary = ?, error = ?, completed_at = ?,
            duration_ms = ?, lines_count = ?, chars_count = ?
        WHERE id = ?
      `)
    }

    const now = Date.now()
    const completedAt = status === 'completed' || status === 'failed' ? now : null

    // Get started_at to calculate duration
    const getStarted = this.getDb().prepare('SELECT started_at FROM tool_calls WHERE id = ?')
    const row = getStarted.get(id) as undefined | {started_at: number}
    const durationMs = row && completedAt ? completedAt - row.started_at : null

    this.stmtUpdateToolCall.run(
      status,
      options?.result ?? null,
      options?.resultSummary ?? null,
      options?.error ?? null,
      completedAt,
      durationMs,
      options?.linesCount ?? null,
      options?.charsCount ?? null,
      id,
    )
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Ensure storage has been initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('AgentStorage not initialized. Call initialize() first.')
    }
  }

  /**
   * Get database instance with type safety (throws if not initialized)
   * Use this instead of this.getDb() for proper type narrowing
   */
  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error('AgentStorage not initialized. Call initialize() first.')
    }

    return this.db
  }

  /**
   * Convert database row to Execution object
   */
  private rowToExecution(row: ExecutionRow): Execution {
    const execution: Execution = {
      createdAt: row.created_at,
      id: row.id,
      input: row.input,
      status: row.status as ExecutionStatus,
      type: row.type as ExecutionType,
      updatedAt: row.updated_at,
    }

    if (row.result) execution.result = row.result
    if (row.error) execution.error = row.error
    if (row.started_at) execution.startedAt = row.started_at
    if (row.completed_at) execution.completedAt = row.completed_at

    return execution
  }

  /**
   * Convert database row to ToolCall object
   */
  private rowToToolCall(row: ToolCallRow): ToolCall {
    const toolCall: ToolCall = {
      args: row.args ?? '{}',
      executionId: row.execution_id,
      id: row.id,
      name: row.name,
      startedAt: row.started_at,
      status: row.status as ToolCallStatus,
    }

    if (row.description) toolCall.description = row.description
    if (row.args_summary) toolCall.argsSummary = row.args_summary
    if (row.file_path) toolCall.filePath = row.file_path
    if (row.result) toolCall.result = row.result
    if (row.result_summary) toolCall.resultSummary = row.result_summary
    if (row.error) toolCall.error = row.error
    if (row.completed_at) toolCall.completedAt = row.completed_at
    if (row.duration_ms) toolCall.durationMs = row.duration_ms
    if (row.lines_count) toolCall.linesCount = row.lines_count
    if (row.chars_count) toolCall.charsCount = row.chars_count

    return toolCall
  }
}

// ==================== SINGLETON ====================

let instance: AgentStorage | null = null
let initPromise: null | Promise<AgentStorage> = null

/**
 * Get the singleton AgentStorage instance (auto-initializes if needed)
 *
 * This is the PRIMARY API - just call this and it handles everything.
 * First call will initialize with provided config, subsequent calls return cached instance.
 *
 * @param config.cleanupOrphans - Cleanup orphaned executions (only Consumer should set this)
 * @param config.inMemory - Use in-memory database (for testing)
 * @param config.storageDir - Directory for agent.db (default: .brv/blobs)
 */
export async function getAgentStorage(config?: {
  cleanupOrphans?: boolean
  inMemory?: boolean
  storageDir?: string
}): Promise<AgentStorage> {
  // Already initialized - return immediately
  if (instance?.initialized) {
    return instance
  }

  // Initialization in progress - wait for it
  if (initPromise) {
    return initPromise
  }

  // Start initialization (only one concurrent init allowed)
  initPromise = (async () => {
    if (!instance) {
      instance = new AgentStorage(config)
    }

    await instance.initialize({cleanupOrphans: config?.cleanupOrphans})
    return instance
  })()

  try {
    return await initPromise
  } finally {
    initPromise = null
  }
}

/**
 * Get the singleton AgentStorage instance (sync version)
 * THROWS if not initialized - use getAgentStorage() instead for auto-init
 *
 * Use this only when you KNOW storage is already initialized (e.g., in Consumer after start)
 */
export function getAgentStorageSync(): AgentStorage {
  if (!instance?.initialized) {
    throw new Error('AgentStorage not initialized. Use await getAgentStorage() instead.')
  }

  return instance
}

/**
 * Initialize the singleton AgentStorage instance
 * @deprecated Use getAgentStorage() directly - it auto-initializes
 */
export async function initializeAgentStorage(config?: {
  cleanupOrphans?: boolean
  inMemory?: boolean
  storageDir?: string
}): Promise<AgentStorage> {
  return getAgentStorage(config)
}

/**
 * Close and clear the singleton AgentStorage instance
 */
export function closeAgentStorage(): void {
  if (instance) {
    instance.close()
    instance = null
  }

  initPromise = null
}
