import type {TaskListItem} from '../../../../shared/transport/events/task-events.js'
import type {TaskHistoryEntry, TaskHistoryStatus} from '../../domain/entities/task-history-entry.js'

// Re-export domain types — single source of truth is in the entity.
export type {TaskHistoryEntry, TaskHistoryStatus} from '../../domain/entities/task-history-entry.js'

export interface ITaskHistoryStore {
  /**
   * Tombstone all matching entries. Defaults to terminal statuses
   * (`'cancelled' | 'completed' | 'error'`) when `statuses` is omitted,
   * so active tasks are preserved.
   * Returns the list of removed taskIds (caller broadcasts `task:deleted` per id).
   */
  clear(options?: {projectPath?: string; statuses?: TaskHistoryStatus[]}): Promise<{
    deletedCount: number
    taskIds: string[]
  }>
  /** Remove a single entry by taskId. Idempotent — returns false on missing/already-deleted. */
  delete(taskId: string): Promise<boolean>
  /**
   * Bulk-delete by taskIds. Returns the subset of input ids that were live
   * (and have now been tombstoned) — invalid, unknown, and already-tombstoned
   * ids are dropped. Callers can rely on the returned array length as the
   * `deletedCount` and on the array contents for per-id broadcasts.
   */
  deleteMany(taskIds: string[]): Promise<string[]>
  /** Retrieve an entry's full Level 2 detail by taskId. Returns undefined if not found or corrupt. */
  getById(taskId: string): Promise<TaskHistoryEntry | undefined>
  /**
   * List entries (summary shape) sorted newest-first.
   *
   * Returns the wire-friendly `TaskListItem` shape — no `responseContent`, `toolCalls`,
   * `reasoningContents`, `sessionId`, or `result`. Callers fetch full detail via `getById`.
   *
   * M2.16: param names align with the wire schema (`createdAfter` / `createdBefore`
   * instead of legacy `after` / `before`). Pagination moved to the handler — store
   * returns ALL matches; no `limit`.
   */
  list(options?: {
    /** Include only entries with createdAt >= this epoch ms. */
    createdAfter?: number
    /** Include only entries with createdAt <= this epoch ms. */
    createdBefore?: number
    /** Include only entries matching these model ids. */
    model?: string[]
    projectPath?: string
    /** Include only entries matching these provider ids. */
    provider?: string[]
    /** Include only entries matching these statuses. */
    status?: TaskHistoryStatus[]
    /** Include only entries matching these task types. */
    type?: string[]
  }): Promise<TaskListItem[]>
  /** Persist (create or overwrite) a history entry. Validates with Zod — throws on invalid shape. */
  save(entry: TaskHistoryEntry): Promise<void>
}
