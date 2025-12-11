/**
 * Queue/Execution domain types for the agent storage system.
 *
 * These types represent the core domain entities for:
 * - Execution queue (curate/query jobs)
 * - Tool call tracking
 * - Consumer lock management
 */

// ==================== EXECUTION TYPES ====================

export type ExecutionType = 'curate' | 'query'
export type ExecutionStatus = 'completed' | 'failed' | 'queued' | 'running'

/**
 * Represents a single execution job in the queue.
 */
export interface Execution {
  completedAt?: number
  createdAt: number
  error?: string
  id: string
  input: string
  result?: string
  startedAt?: number
  status: ExecutionStatus
  type: ExecutionType
  updatedAt: number
}

// ==================== TOOL CALL TYPES ====================

export type ToolCallStatus = 'completed' | 'failed' | 'running'

/**
 * Represents a tool call made during an execution.
 */
export interface ToolCall {
  args: string
  argsSummary?: string
  charsCount?: number
  completedAt?: number
  description?: string
  durationMs?: number
  error?: string
  executionId: string
  filePath?: string
  id: string
  linesCount?: number
  name: string
  result?: string
  resultSummary?: string
  startedAt: number
  status: ToolCallStatus
}

/**
 * Input for creating a new tool call record.
 */
export interface ToolCallInfo {
  args: Record<string, unknown>
  argsSummary?: string
  description?: string
  filePath?: string
  name: string
}

/**
 * Options for updating an existing tool call.
 */
export interface ToolCallUpdateOptions {
  charsCount?: number
  error?: string
  linesCount?: number
  result?: string
  resultSummary?: string
}

// ==================== CONSUMER LOCK TYPES ====================

/**
 * Represents an active consumer lock.
 */
export interface ConsumerLock {
  id: string
  lastHeartbeat: number
  pid: number
  startedAt: number
}
