import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {type ProviderConnectRequest, type ProviderConnectResponse, ProviderEvents} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getProvidersQueryOptions} from './get-providers.js'

export type ConnectProviderDTO = {
  apiKey?: string
  providerId: string
}

export const connectProvider = ({apiKey, providerId}: ConnectProviderDTO): Promise<ProviderConnectResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ProviderConnectResponse, ProviderConnectRequest>(ProviderEvents.CONNECT, {
    apiKey,
    providerId,
  })
}

type UseConnectProviderOptions = {
  mutationConfig?: MutationConfig<typeof connectProvider>
}

export const useConnectProvider = ({mutationConfig}: UseConnectProviderOptions = {}) => {
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
    mutationFn: connectProvider,
  })
}
