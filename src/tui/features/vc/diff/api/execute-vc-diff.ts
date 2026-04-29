import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {
  type IVcDiffsRequest,
  type IVcDiffsResponse,
  VcEvents,
} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcDiff = (request: IVcDiffsRequest): Promise<IVcDiffsResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))
  return apiClient.request<IVcDiffsResponse, IVcDiffsRequest>(VcEvents.DIFFS, request)
}

type UseExecuteVcDiffOptions = {
  mutationConfig?: MutationConfig<typeof executeVcDiff>
}

export const useExecuteVcDiff = ({mutationConfig}: UseExecuteVcDiffOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcDiff,
  })
