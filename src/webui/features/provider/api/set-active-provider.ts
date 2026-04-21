import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  ProviderEvents,
  type ProviderSetActiveRequest,
  type ProviderSetActiveResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {getActiveProviderConfigQueryOptions} from './get-active-provider-config'
import {getProvidersQueryOptions} from './get-providers'

export type SetActiveProviderDTO = {
  providerId: string
}

export const setActiveProvider = ({providerId}: SetActiveProviderDTO): Promise<ProviderSetActiveResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ProviderSetActiveResponse, ProviderSetActiveRequest>(ProviderEvents.SET_ACTIVE, {providerId})
}

type UseSetActiveProviderOptions = {
  mutationConfig?: MutationConfig<typeof setActiveProvider>
}

export const useSetActiveProvider = ({mutationConfig}: UseSetActiveProviderOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getProvidersQueryOptions().queryKey})
      queryClient.invalidateQueries({queryKey: getActiveProviderConfigQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: setActiveProvider,
  })
}
