import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {type IVcResetRequest, type IVcResetResponse, VcEvents} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcReset = (request: IVcResetRequest): Promise<IVcResetResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcResetResponse>(VcEvents.RESET, request)
}

type UseExecuteVcResetOptions = {
  mutationConfig?: MutationConfig<typeof executeVcReset>
}

export const useExecuteVcReset = ({mutationConfig}: UseExecuteVcResetOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcReset,
  })
