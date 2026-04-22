import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {PushEvents, type PushExecuteRequest, type PushExecuteResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export type ExecutePushDTO = {
  branch: string
}

export const executePush = ({branch}: ExecutePushDTO): Promise<PushExecuteResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<PushExecuteResponse, PushExecuteRequest>(PushEvents.EXECUTE, {branch})
}

type UseExecutePushOptions = {
  mutationConfig?: MutationConfig<typeof executePush>
}

export const useExecutePush = ({mutationConfig}: UseExecutePushOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executePush,
  })
