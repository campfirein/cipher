import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {ResetEvents, type ResetExecuteResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const executeReset = (): Promise<ResetExecuteResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ResetExecuteResponse>(ResetEvents.EXECUTE)
}

type UseExecuteResetOptions = {
  mutationConfig?: MutationConfig<typeof executeReset>
}

export const useExecuteReset = ({mutationConfig}: UseExecuteResetOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeReset,
  })
