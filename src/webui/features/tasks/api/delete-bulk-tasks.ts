import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type TaskDeleteBulkRequest,
  type TaskDeleteBulkResponse,
  TaskEvents,
} from '../../../../shared/transport/events/task-events'
import {useTransportStore} from '../../../stores/transport-store'

export const deleteBulkTasks = async (payload: TaskDeleteBulkRequest): Promise<TaskDeleteBulkResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) throw new Error('Not connected')

  const response = await apiClient.request<TaskDeleteBulkResponse, TaskDeleteBulkRequest>(
    TaskEvents.DELETE_BULK,
    payload,
  )
  if (response.error) throw new Error(response.error)
  return response
}

type UseDeleteBulkTasksOptions = {
  mutationConfig?: MutationConfig<typeof deleteBulkTasks>
}

export const useDeleteBulkTasks = ({mutationConfig}: UseDeleteBulkTasksOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: deleteBulkTasks,
  })
