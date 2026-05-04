import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type TaskDeleteRequest,
  type TaskDeleteResponse,
  TaskEvents,
} from '../../../../shared/transport/events/task-events'
import {useTransportStore} from '../../../stores/transport-store'

export const deleteTask = async (payload: TaskDeleteRequest): Promise<TaskDeleteResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) throw new Error('Not connected')

  const response = await apiClient.request<TaskDeleteResponse, TaskDeleteRequest>(TaskEvents.DELETE, payload)
  if (!response.success) throw new Error(response.error ?? 'Delete failed')
  return response
}

type UseDeleteTaskOptions = {
  mutationConfig?: MutationConfig<typeof deleteTask>
}

export const useDeleteTask = ({mutationConfig}: UseDeleteTaskOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: deleteTask,
  })
