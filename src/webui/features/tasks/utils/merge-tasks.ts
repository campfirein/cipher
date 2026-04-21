import type {TaskListItem} from '../../../../shared/transport/events/task-events'
import type {StoredTask} from '../types/stored-task'

/**
 * Merge incoming task snapshots into a current list by taskId.
 * Existing tasks are field-merged (incoming wins on conflict, but undefined fields don't clobber).
 * New tasks are appended at the end.
 */
export function mergeTaskList(current: StoredTask[], incoming: TaskListItem[]): StoredTask[] {
  if (incoming.length === 0) return current

  const incomingById = new Map(incoming.map((task) => [task.taskId, task]))
  const merged: StoredTask[] = current.map((task) => {
    const next = incomingById.get(task.taskId)
    if (!next) return task
    incomingById.delete(task.taskId)
    return mergeOne(task, next)
  })

  for (const task of incomingById.values()) {
    merged.push(task as StoredTask)
  }

  return merged
}

export function removeTaskFromList(current: StoredTask[], taskId: string): StoredTask[] {
  const next = current.filter((task) => task.taskId !== taskId)
  return next.length === current.length ? current : next
}

function mergeOne(existing: StoredTask, incoming: TaskListItem): StoredTask {
  return {
    ...existing,
    ...stripUndefined(incoming),
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const result: Partial<T> = {}
  for (const [key, val] of Object.entries(value)) {
    if (val !== undefined) {
      ;(result as Record<string, unknown>)[key] = val
    }
  }

  return result
}
