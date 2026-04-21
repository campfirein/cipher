import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type TaskAckResponse,
  type TaskCreateRequest,
  TaskEvents,
} from '../../../../shared/transport/events/task-events'
import {useTransportStore} from '../../../stores/transport-store'

export type CreateTaskDTO = TaskCreateRequest

export const createTask = (payload: CreateTaskDTO): Promise<TaskAckResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<TaskAckResponse, TaskCreateRequest>(TaskEvents.CREATE, payload)
}

type UseCreateTaskOptions = {
  mutationConfig?: MutationConfig<typeof createTask>
}

export const useCreateTask = ({mutationConfig}: UseCreateTaskOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: createTask,
  })
