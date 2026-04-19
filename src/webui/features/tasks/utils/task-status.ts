import type {TaskListItem, TaskListItemStatus} from '../../../../shared/transport/events/task-events'

export type TaskStatusGroup = 'completed' | 'in_progress' | 'pending'

/**
 * Display the task type without internal mode suffixes.
 * `curate-folder` is a folder-mode `curate` task; the folder chip in the input
 * section already conveys that, so flatten both forms to `curate` in labels.
 */
export function displayTaskType(type: string): string {
  if (type === 'curate-folder') return 'curate'
  return type
}

export const TASK_STATUS_GROUPS: TaskStatusGroup[] = ['pending', 'in_progress', 'completed']

const TERMINAL_STATUSES = new Set<TaskListItemStatus>(['cancelled', 'completed', 'error'])

export function toStatusGroup(status: TaskListItemStatus): TaskStatusGroup {
  if (status === 'created') return 'pending'
  if (status === 'started') return 'in_progress'
  return 'completed'
}

export function isTerminalStatus(status: TaskListItemStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function isActiveStatus(status: TaskListItemStatus): boolean {
  return !TERMINAL_STATUSES.has(status)
}

export interface TaskGroupCounts {
  completed: number
  inProgress: number
  pending: number
  total: number
}

export function countByGroup(tasks: TaskListItem[]): TaskGroupCounts {
  const counts: TaskGroupCounts = {completed: 0, inProgress: 0, pending: 0, total: tasks.length}
  for (const task of tasks) {
    const group = toStatusGroup(task.status)
    if (group === 'pending') counts.pending++
    else if (group === 'in_progress') counts.inProgress++
    else counts.completed++
  }

  return counts
}
