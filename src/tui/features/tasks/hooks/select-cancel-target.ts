import type {Task, TaskStatus} from '../stores/tasks-store.js'

/** Terminal statuses — tasks in these states can no longer be cancelled. */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['cancelled', 'completed', 'error'])

/**
 * Pick the taskId Ctrl+Q should target. Returns the most recently created
 * non-terminal task in the tasks map, or undefined when there is nothing
 * cancellable. Pure function — extracted from the React hook so it can be
 * unit-tested without Ink.
 */
export function selectCancelTargetTaskId(tasks: ReadonlyMap<string, Task>): string | undefined {
  let candidate: Task | undefined
  for (const task of tasks.values()) {
    if (TERMINAL_STATUSES.has(task.status)) continue
    if (!candidate || task.createdAt > candidate.createdAt) {
      candidate = task
    }
  }

  return candidate?.taskId
}
