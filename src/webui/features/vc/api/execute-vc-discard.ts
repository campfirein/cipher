import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {type IVcDiscardRequest, type IVcDiscardResponse, VcEvents} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcDiscard = (request: IVcDiscardRequest): Promise<IVcDiscardResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcDiscardResponse, IVcDiscardRequest>(VcEvents.DISCARD, request)
}

type UseVcDiscardOptions = {
  mutationConfig?: MutationConfig<typeof executeVcDiscard>
}

export const useVcDiscard = ({mutationConfig}: UseVcDiscardOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcDiscard,
  })
}
