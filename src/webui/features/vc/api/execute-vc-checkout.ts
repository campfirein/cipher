import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type IVcCheckoutRequest,
  type IVcCheckoutResponse,
  VcEvents,
} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcBranchesQueryOptions} from './get-vc-branches'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcCheckout = (request: IVcCheckoutRequest): Promise<IVcCheckoutResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcCheckoutResponse, IVcCheckoutRequest>(VcEvents.CHECKOUT, request)
}

type UseVcCheckoutOptions = {
  mutationConfig?: MutationConfig<typeof executeVcCheckout>
}

export const useVcCheckout = ({mutationConfig}: UseVcCheckoutOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      queryClient.invalidateQueries({queryKey: getVcBranchesQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcCheckout,
  })
}
