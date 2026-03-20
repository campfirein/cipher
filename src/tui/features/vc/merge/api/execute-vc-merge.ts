import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {
  type IVcMergeRequest,
  type IVcMergeResponse,
  VcEvents,
} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcMerge = (request: IVcMergeRequest): Promise<IVcMergeResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcMergeResponse>(VcEvents.MERGE, request)
}

type UseExecuteVcMergeOptions = {
  mutationConfig?: MutationConfig<typeof executeVcMerge>
}

export const useExecuteVcMerge = ({mutationConfig}: UseExecuteVcMergeOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcMerge,
  })
