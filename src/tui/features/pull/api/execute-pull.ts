import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {PullEvents, type PullExecuteRequest, type PullExecuteResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export type ExecutePullDTO = {
  branch: string
}

export const executePull = ({branch}: ExecutePullDTO): Promise<PullExecuteResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<PullExecuteResponse, PullExecuteRequest>(PullEvents.EXECUTE, {branch})
}

type UseExecutePullOptions = {
  mutationConfig?: MutationConfig<typeof executePull>
}

export const useExecutePull = ({mutationConfig}: UseExecutePullOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executePull,
  })
