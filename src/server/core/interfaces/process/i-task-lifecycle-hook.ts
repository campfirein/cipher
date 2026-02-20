import type {LlmToolResultEvent} from '../../domain/transport/schemas.js'
import type {TaskInfo} from '../../domain/transport/task-info.js'

/**
 * Hook interface for observing task lifecycle events.
 *
 * All methods are optional — implement only the events you care about.
 * Implementations must never throw; errors should be handled internally.
 *
 * Design: TaskRouter accepts lifecycleHooks[] so new hooks (e.g. QueryLogHandler)
 * can be added without modifying TaskRouter.
 */
export interface ITaskLifecycleHook {
  /** Called after onTaskCompleted, onTaskError, or onTaskCancelled to release in-memory resources. */
  cleanup?(taskId: string): void
  /** Called when a task completes successfully. */
  onTaskCompleted?(taskId: string, result: string, task: TaskInfo): Promise<void>
  /** Called when a new task is created. Return {logId} to associate a log entry with the task. */
  onTaskCreate?(task: TaskInfo): Promise<void | {logId?: string}>
  /** Called when a task is cancelled by the user. Distinct from onTaskError. */
  onTaskCancelled?(taskId: string, task: TaskInfo): Promise<void>
  /** Called when a task fails with an error. */
  onTaskError?(taskId: string, errorMessage: string, task: TaskInfo): Promise<void>
  /** Called when an LLM tool result event is received for an ACTIVE task (not grace-period). */
  onToolResult?(taskId: string, payload: LlmToolResultEvent): void
}
