import type {TaskListItemStatus} from '../../../../shared/transport/events/task-events'

type TaskError = {
  code?: string
  message: string
  name?: string
}

type Input = {
  error?: TaskError
  status: TaskListItemStatus
}

const INTERRUPTED_CODE = 'INTERRUPTED'
const INTERRUPTED_MESSAGE = 'Interrupted (daemon terminated)'

export function isInterrupted(task: Input): boolean {
  if (task.status !== 'error') return false
  if (!task.error) return false
  if (task.error.code === INTERRUPTED_CODE) return true
  if (task.error.message === INTERRUPTED_MESSAGE) return true
  return false
}
