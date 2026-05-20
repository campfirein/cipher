import {useQuery} from '@tanstack/react-query'

import {
  TaskEvents,
  type TaskListRequest,
  type TaskListResponse,
} from '../../../../shared/transport/events/task-events'
import {useTransportStore} from '../../../stores/transport-store'

export const getTasks = (data?: TaskListRequest): Promise<TaskListResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<TaskListResponse, TaskListRequest>(TaskEvents.LIST, data)
}

export type UseGetTasksOptions = TaskListRequest

export const useGetTasks = (options: UseGetTasksOptions = {}) =>
  useQuery({
    queryFn: () => getTasks(options),
    queryKey: ['tasks', 'list', options],
  })
