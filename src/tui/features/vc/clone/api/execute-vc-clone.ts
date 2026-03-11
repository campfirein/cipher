import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {
  type IVcCloneRequest,
  type IVcCloneResponse,
  VcEvents,
} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcClone = (request: IVcCloneRequest): Promise<IVcCloneResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcCloneResponse>(VcEvents.CLONE, request)
}

type UseExecuteVcCloneOptions = {
  mutationConfig?: MutationConfig<typeof executeVcClone>
}

export const useExecuteVcClone = ({mutationConfig}: UseExecuteVcCloneOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcClone,
  })
