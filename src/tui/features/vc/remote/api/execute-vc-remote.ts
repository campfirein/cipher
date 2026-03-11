import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {
  type IVcRemoteRequest,
  type IVcRemoteResponse,
  VcEvents,
} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcRemote = (request: IVcRemoteRequest): Promise<IVcRemoteResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcRemoteResponse>(VcEvents.REMOTE, request)
}

type UseExecuteVcRemoteOptions = {
  mutationConfig?: MutationConfig<typeof executeVcRemote>
}

export const useExecuteVcRemote = ({mutationConfig}: UseExecuteVcRemoteOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcRemote,
  })
