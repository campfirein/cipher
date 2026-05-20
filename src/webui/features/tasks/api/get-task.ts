import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {
  TaskEvents,
  type TaskGetRequest,
  type TaskGetResponse,
} from '../../../../shared/transport/events/task-events'
import {useTransportStore} from '../../../stores/transport-store'

export const getTask = (taskId: string): Promise<TaskGetResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<TaskGetResponse, TaskGetRequest>(TaskEvents.GET, {taskId})
}

export const getTaskQueryOptions = (taskId: string, enabled: boolean) =>
  queryOptions({
    enabled,
    queryFn: () => getTask(taskId),
    queryKey: ['tasks', 'detail', taskId],
    staleTime: Number.POSITIVE_INFINITY,
  })

type UseGetTaskDetailOptions = {
  enabled: boolean
  queryConfig?: QueryConfig<typeof getTaskQueryOptions>
  taskId: string
}

export const useGetTaskDetail = ({enabled, queryConfig, taskId}: UseGetTaskDetailOptions) =>
  useQuery({
    ...getTaskQueryOptions(taskId, enabled),
    ...queryConfig,
    enabled,
  })
