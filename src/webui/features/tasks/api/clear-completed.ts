import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type TaskClearCompletedRequest,
  type TaskClearCompletedResponse,
  TaskEvents,
} from '../../../../shared/transport/events/task-events'
import {useTransportStore} from '../../../stores/transport-store'

export const clearCompleted = async (
  payload: TaskClearCompletedRequest,
): Promise<TaskClearCompletedResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) throw new Error('Not connected')

  const response = await apiClient.request<TaskClearCompletedResponse, TaskClearCompletedRequest>(
    TaskEvents.CLEAR_COMPLETED,
    payload,
  )
  if (response.error) throw new Error(response.error)
  return response
}

type UseClearCompletedOptions = {
  mutationConfig?: MutationConfig<typeof clearCompleted>
}

export const useClearCompleted = ({mutationConfig}: UseClearCompletedOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: clearCompleted,
  })
