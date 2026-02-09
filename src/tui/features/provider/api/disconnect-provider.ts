import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {type ProviderDisconnectRequest, type ProviderDisconnectResponse, ProviderEvents} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getProvidersQueryOptions} from './get-providers.js'

export type DisconnectProviderDTO = {
  providerId: string
}

export const disconnectProvider = ({providerId}: DisconnectProviderDTO): Promise<ProviderDisconnectResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ProviderDisconnectResponse, ProviderDisconnectRequest>(ProviderEvents.DISCONNECT, {
    providerId,
  })
}

type UseDisconnectProviderOptions = {
  mutationConfig?: MutationConfig<typeof disconnectProvider>
}

export const useDisconnectProvider = ({mutationConfig}: UseDisconnectProviderOptions = {}) => {
  const queryClient = useQueryClient()

  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({
        queryKey: getProvidersQueryOptions().queryKey,
      })
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: disconnectProvider,
  })
}
