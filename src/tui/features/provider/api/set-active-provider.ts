import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {ProviderEvents, type ProviderSetActiveRequest, type ProviderSetActiveResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getProvidersQueryOptions} from './get-providers.js'

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
      queryClient.invalidateQueries({
        queryKey: getProvidersQueryOptions().queryKey,
      })
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: setActiveProvider,
  })
}
