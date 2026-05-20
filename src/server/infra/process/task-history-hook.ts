/**
 * TaskHistoryHook — persists `TaskInfo` to `ITaskHistoryStore` at every
 * lifecycle transition (created / started-via-throttle / terminal).
 *
 * Wired into TaskRouter via `lifecycleHooks[]`. The 4 existing methods fire
 * synchronously at create + terminal; the new `onTaskUpdate` fires on the
 * throttled flush (~100ms) for in-flight mutations populated by the
 * llmservice accumulator.
 *
 * Holds NO per-task state — every method reads from the live `TaskInfo`
 * passed in. Errors are swallowed via `processLog`; tasks without
 * `projectPath` are skipped silently.
 */

import type {TaskHistoryEntry} from '../../core/domain/entities/task-history-entry.js'
import type {TaskInfo} from '../../core/domain/transport/task-info.js'
import type {ITaskLifecycleHook} from '../../core/interfaces/process/i-task-lifecycle-hook.js'
import type {ITaskHistoryStore} from '../../core/interfaces/storage/i-task-history-store.js'

import {TaskHistoryEntrySchema} from '../../core/domain/entities/task-history-entry.js'
import {processLog} from '../../utils/process-logger.js'
import {buildTaskHistoryEntryCandidate} from './task-history-entry-builder.js'

type TaskHistoryHookOptions = {
  /** Per-project store factory (DIP — never depends on FileTaskHistoryStore directly). */
  getStore: (projectPath: string) => ITaskHistoryStore
}

export class TaskHistoryHook implements ITaskLifecycleHook {
  private readonly getStore: TaskHistoryHookOptions['getStore']

  constructor(opts: TaskHistoryHookOptions) {
    this.getStore = opts.getStore
  }

  async onTaskCancelled(_taskId: string, task: TaskInfo): Promise<void> {
    await this.persist(task, {completedAt: Date.now(), status: 'cancelled'})
  }

  async onTaskCompleted(_taskId: string, result: string, task: TaskInfo): Promise<void> {
    await this.persist(task, {
      completedAt: Date.now(),
      ...(result ? {result} : {}),
      status: 'completed',
    })
  }

  async onTaskCreate(task: TaskInfo): Promise<void> {
    await this.persist(task, {status: 'created'})
  }

  async onTaskError(_taskId: string, errorMessage: string, task: TaskInfo): Promise<void> {
    await this.persist(task, {
      completedAt: Date.now(),
      error: {code: 'TASK_ERROR', message: errorMessage, name: 'TaskError'},
      status: 'error',
    })
  }

  async onTaskUpdate(task: TaskInfo): Promise<void> {
    await this.persist(task)
  }

  /**
   * Build + save a `TaskHistoryEntry` from the current `TaskInfo`. Optional
   * `override` injects branch-specific fields (status / completedAt / error /
   * result). When omitted, the branch shape is inferred from `task.status`
   * by `buildTaskHistoryEntryCandidate`.
   */
  private async persist(task: TaskInfo, override?: Record<string, unknown>): Promise<void> {
    if (!task.projectPath) return

    const candidate = buildTaskHistoryEntryCandidate({override, task})

    let entry: TaskHistoryEntry
    try {
      entry = TaskHistoryEntrySchema.parse(candidate)
    } catch (error) {
      processLog(
        `TaskHistoryHook: failed to build entry for ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    try {
      await this.getStore(task.projectPath).save(entry)
    } catch (error) {
      processLog(
        `TaskHistoryHook: store.save failed for ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
