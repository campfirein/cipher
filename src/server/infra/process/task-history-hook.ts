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

import {TASK_HISTORY_ID_PREFIX} from '../../constants.js'
import {TASK_HISTORY_SCHEMA_VERSION, TaskHistoryEntrySchema} from '../../core/domain/entities/task-history-entry.js'
import {processLog} from '../../utils/process-logger.js'

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

  /** Build the base shape (fields shared by every status branch). */
  private baseFromTaskInfo(task: TaskInfo): Record<string, unknown> {
    return {
      content: task.content,
      createdAt: task.createdAt,
      id: `${TASK_HISTORY_ID_PREFIX}-${task.taskId}`,
      projectPath: task.projectPath,
      schemaVersion: TASK_HISTORY_SCHEMA_VERSION,
      taskId: task.taskId,
      type: task.type,
      ...(task.clientCwd === undefined ? {} : {clientCwd: task.clientCwd}),
      ...(task.files === undefined ? {} : {files: task.files}),
      ...(task.folderPath === undefined ? {} : {folderPath: task.folderPath}),
      ...(task.logId === undefined ? {} : {logId: task.logId}),
      ...(task.model === undefined ? {} : {model: task.model}),
      ...(task.provider === undefined ? {} : {provider: task.provider}),
      ...(task.reasoningContents === undefined ? {} : {reasoningContents: task.reasoningContents}),
      ...(task.responseContent === undefined ? {} : {responseContent: task.responseContent}),
      ...(task.sessionId === undefined ? {} : {sessionId: task.sessionId}),
      ...(task.toolCalls === undefined ? {} : {toolCalls: task.toolCalls}),
      ...(task.worktreeRoot === undefined ? {} : {worktreeRoot: task.worktreeRoot}),
    }
  }

  /**
   * Build + save a `TaskHistoryEntry` from the current `TaskInfo`. Optional
   * `override` injects branch-specific fields (status / completedAt / error /
   * result). When omitted, the branch shape is inferred from `task.status`.
   */
  private async persist(task: TaskInfo, override?: Record<string, unknown>): Promise<void> {
    if (!task.projectPath) return

    const candidate = {
      ...this.baseFromTaskInfo(task),
      ...this.statusShapeFromTaskInfo(task),
      ...override,
    }

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

  /**
   * Build the per-branch shape inferred from `task.status`. Override-only
   * paths (terminal hooks) supply their own status; this is the default for
   * `onTaskUpdate` calls during in-flight transitions.
   */
  private statusShapeFromTaskInfo(task: TaskInfo): Record<string, unknown> {
    switch (task.status) {
      case 'cancelled':
      case 'completed': {
        return {
          completedAt: task.completedAt ?? Date.now(),
          status: task.status,
          ...(task.startedAt === undefined ? {} : {startedAt: task.startedAt}),
          ...(task.status === 'completed' && task.result !== undefined ? {result: task.result} : {}),
        }
      }

      case 'error': {
        return {
          completedAt: task.completedAt ?? Date.now(),
          error: task.error ?? {code: 'TASK_ERROR', message: 'unknown error', name: 'TaskError'},
          status: 'error',
          ...(task.startedAt === undefined ? {} : {startedAt: task.startedAt}),
        }
      }

      case 'started': {
        return {
          startedAt: task.startedAt ?? task.createdAt,
          status: 'started',
        }
      }

      // 'created' or undefined — minimal base, no extra branch fields.
      default: {
        return {status: 'created'}
      }
    }
  }
}
