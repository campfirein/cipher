import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {
  type IVcFetchRequest,
  type IVcFetchResponse,
  VcEvents,
} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcFetch = (request: IVcFetchRequest): Promise<IVcFetchResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcFetchResponse>(VcEvents.FETCH, request)
}

type UseExecuteVcFetchOptions = {
  mutationConfig?: MutationConfig<typeof executeVcFetch>
}

export const useExecuteVcFetch = ({mutationConfig}: UseExecuteVcFetchOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcFetch,
  })
