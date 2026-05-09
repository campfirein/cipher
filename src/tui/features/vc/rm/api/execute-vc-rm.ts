import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {type IVcRmRequest, type IVcRmResponse, VcEvents} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcRm = (request: IVcRmRequest): Promise<IVcRmResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcRmResponse>(VcEvents.RM, request)
}

type UseExecuteVcRmOptions = {
  mutationConfig?: MutationConfig<typeof executeVcRm>
}

export const useExecuteVcRm = ({mutationConfig}: UseExecuteVcRmOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcRm,
  })
