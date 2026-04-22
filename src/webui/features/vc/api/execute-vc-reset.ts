import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {type IVcResetRequest, type IVcResetResponse, VcEvents} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcReset = (request: IVcResetRequest = {}): Promise<IVcResetResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcResetResponse, IVcResetRequest>(VcEvents.RESET, request)
}

type UseVcResetOptions = {
  mutationConfig?: MutationConfig<typeof executeVcReset>
}

export const useVcReset = ({mutationConfig}: UseVcResetOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcReset,
  })
}
