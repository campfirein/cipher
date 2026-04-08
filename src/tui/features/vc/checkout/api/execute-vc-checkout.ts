import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {
  type IVcCheckoutRequest,
  type IVcCheckoutResponse,
  VcEvents,
} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcCheckout = (request: IVcCheckoutRequest): Promise<IVcCheckoutResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcCheckoutResponse>(VcEvents.CHECKOUT, request)
}

type UseExecuteVcCheckoutOptions = {
  mutationConfig?: MutationConfig<typeof executeVcCheckout>
}

export const useExecuteVcCheckout = ({mutationConfig}: UseExecuteVcCheckoutOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcCheckout,
  })
