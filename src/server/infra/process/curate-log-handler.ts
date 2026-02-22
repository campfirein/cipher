import type {CurateLogEntry, CurateLogOperation, CurateLogSummary} from '../../core/domain/entities/curate-log-entry.js'
import type {LlmToolResultEvent} from '../../core/domain/transport/schemas.js'
import type {TaskInfo} from '../../core/domain/transport/task-info.js'
import type {ITaskLifecycleHook} from '../../core/interfaces/process/i-task-lifecycle-hook.js'
import type {ICurateLogStore} from '../../core/interfaces/storage/i-curate-log-store.js'

import {extractCurateOperations} from '../../utils/curate-result-parser.js'
import {getProjectDataDir} from '../../utils/path-utils.js'
import {transportLog} from '../../utils/process-logger.js'
import {FileCurateLogStore} from '../storage/file-curate-log-store.js'

// ── Internal state ────────────────────────────────────────────────────────────

type TaskState = {
  /** Cached initial entry — used in onTaskCompleted/onTaskError to avoid a getById round-trip. */
  entry: CurateLogEntry
  operations: CurateLogOperation[]
  projectPath: string
}

const CURATE_TASK_TYPES = ['curate', 'curate-folder'] as const

// ── Summary computation ───────────────────────────────────────────────────────

export function computeSummary(operations: CurateLogOperation[]): CurateLogSummary {
  const summary: CurateLogSummary = {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0}

  for (const op of operations) {
    if (op.status === 'failed') {
      summary.failed++
      continue
    }

    switch (op.type) {
      case 'ADD': {
        summary.added++
        break
      }

      case 'DELETE': {
        summary.deleted++
        break
      }

      case 'MERGE': {
        summary.merged++
        break
      }

      case 'UPDATE': {
        summary.updated++
        break
      }

      case 'UPSERT': {
        // UPSERT is intentionally counted as "updated" — CurateLogSummary has no separate upserted field.
        summary.updated++
        break
      }
    }
  }

  return summary
}

// ── CurateLogHandler ──────────────────────────────────────────────────────────

/**
 * Lifecycle hook that transparently logs curate task execution.
 *
 * Wired into TaskRouter via lifecycleHooks[]. Writes log entries to
 * per-project FileCurateLogStore. All I/O errors are swallowed — logging
 * must never block or affect curate task execution.
 */
export class CurateLogHandler implements ITaskLifecycleHook {
  /** Active task count per projectPath — used to evict idle stores. */
  private readonly activeTaskCount = new Map<string, number>()
  /** Per-project store cache (one store per projectPath). Evicted when no active tasks remain. */
  private readonly stores = new Map<string, ICurateLogStore>()
  /** In-memory state per active task. Cleared on cleanup(). */
  private readonly tasks = new Map<string, TaskState>()

  /**
   * @param createStore - Optional factory for testing. Default: FileCurateLogStore.
   */
  constructor(private readonly createStore?: (projectPath: string) => ICurateLogStore) {}

  cleanup(taskId: string): void {
    const state = this.tasks.get(taskId)
    this.tasks.delete(taskId)

    if (state) {
      const remaining = (this.activeTaskCount.get(state.projectPath) ?? 1) - 1
      if (remaining <= 0) {
        this.activeTaskCount.delete(state.projectPath)
        this.stores.delete(state.projectPath)
      } else {
        this.activeTaskCount.set(state.projectPath, remaining)
      }
    }
  }

  async onTaskCancelled(taskId: string, _task: TaskInfo): Promise<void> {
    const state = this.tasks.get(taskId)
    if (!state) return

    const store = this.getOrCreateStore(state.projectPath)

    const updated: CurateLogEntry = {
      ...state.entry,
      completedAt: Date.now(),
      operations: state.operations,
      status: 'cancelled',
      summary: computeSummary(state.operations),
    }

    await store.save(updated).catch((error: unknown) => {
      transportLog(
        `CurateLogHandler: failed to save cancelled entry for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  async onTaskCompleted(taskId: string, result: string, _task: TaskInfo): Promise<void> {
    const state = this.tasks.get(taskId)
    if (!state) return

    const store = this.getOrCreateStore(state.projectPath)

    const updated: CurateLogEntry = {
      ...state.entry,
      completedAt: Date.now(),
      operations: state.operations,
      response: result || undefined,
      status: 'completed',
      summary: computeSummary(state.operations),
    }

    await store.save(updated).catch((error: unknown) => {
      transportLog(
        `CurateLogHandler: failed to save completed entry for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  async onTaskCreate(task: TaskInfo): Promise<void | {logId?: string}> {
    if (!CURATE_TASK_TYPES.includes(task.type as (typeof CURATE_TASK_TYPES)[number])) return
    if (!task.projectPath) return

    const store = this.getOrCreateStore(task.projectPath)
    const logId = await store.getNextId().catch(() => {})
    if (!logId) return

    const entry: CurateLogEntry = {
      id: logId,
      input: {
        context: task.content || undefined,
        ...(task.files?.length ? {files: task.files} : {}),
        ...(task.folderPath ? {folders: [task.folderPath]} : {}),
      },
      operations: [],
      startedAt: task.createdAt,
      status: 'processing',
      summary: {added: 0, deleted: 0, failed: 0, merged: 0, updated: 0},
      taskId: task.taskId,
    }

    // Set in-memory state BEFORE disk write so onToolResult can see it immediately.
    // Caching `entry` here lets onTaskCompleted/onTaskError rebuild the final entry
    // without a getById round-trip — so completion is never lost even if this initial
    // save fails.
    this.tasks.set(task.taskId, {entry, operations: [], projectPath: task.projectPath})
    this.activeTaskCount.set(task.projectPath, (this.activeTaskCount.get(task.projectPath) ?? 0) + 1)

    // Fire-and-forget: logId is already known, save is best-effort.
    // Callers receive logId immediately without waiting for disk I/O.
    store.save(entry).catch((error: unknown) => {
      transportLog(
        `CurateLogHandler: failed to save processing entry for ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    })

    return {logId}
  }

  async onTaskError(taskId: string, errorMessage: string, _task: TaskInfo): Promise<void> {
    const state = this.tasks.get(taskId)
    if (!state) return

    const store = this.getOrCreateStore(state.projectPath)

    const updated: CurateLogEntry = {
      ...state.entry,
      completedAt: Date.now(),
      error: errorMessage,
      operations: state.operations,
      status: 'error',
      summary: computeSummary(state.operations),
    }

    await store.save(updated).catch((error: unknown) => {
      transportLog(
        `CurateLogHandler: failed to save error entry for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  onToolResult(taskId: string, payload: LlmToolResultEvent): void {
    const state = this.tasks.get(taskId)
    if (!state) return

    const ops = extractCurateOperations(payload)
    state.operations.push(...ops)
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private getOrCreateStore(projectPath: string): ICurateLogStore {
    const existing = this.stores.get(projectPath)
    if (existing) return existing

    const store = this.createStore
      ? this.createStore(projectPath)
      : new FileCurateLogStore({baseDir: getProjectDataDir(projectPath)})

    this.stores.set(projectPath, store)
    return store
  }
}
