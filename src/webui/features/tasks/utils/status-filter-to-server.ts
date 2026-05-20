import type {TaskListItemStatus} from '../../../../shared/transport/events/task-events'
import type {StatusFilter} from '../stores/task-store'

const STATUS_FILTER_TO_SERVER: Record<StatusFilter, TaskListItemStatus[] | undefined> = {
  all: undefined,
  cancelled: ['cancelled'],
  completed: ['completed'],
  failed: ['error'],
  running: ['created', 'started'],
}

export function statusFilterToServer(filter: StatusFilter): TaskListItemStatus[] | undefined {
  return STATUS_FILTER_TO_SERVER[filter]
}
