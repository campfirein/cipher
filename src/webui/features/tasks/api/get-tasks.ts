import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

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

export const getTasksQueryOptions = (projectPath?: string) =>
  queryOptions({
    queryFn: () => getTasks(projectPath ? {projectPath} : undefined),
    queryKey: ['tasks', 'list', projectPath ?? ''],
  })

type UseGetTasksOptions = {
  projectPath?: string
  queryConfig?: QueryConfig<typeof getTasksQueryOptions>
}

export const useGetTasks = ({projectPath, queryConfig}: UseGetTasksOptions = {}) =>
  useQuery({
    ...getTasksQueryOptions(projectPath),
    ...queryConfig,
  })
