import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  HubEvents,
  type HubRegistryRemoveRequest,
  type HubRegistryRemoveResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {getHubEntriesQueryOptions} from './get-hub-entries'
import {getHubRegistriesQueryOptions} from './list-hub-registries'

export type RemoveHubRegistryDTO = {
  name: string
}

export const removeHubRegistry = ({name}: RemoveHubRegistryDTO): Promise<HubRegistryRemoveResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<HubRegistryRemoveResponse, HubRegistryRemoveRequest>(HubEvents.REGISTRY_REMOVE, {name})
}

type UseRemoveHubRegistryOptions = {
  mutationConfig?: MutationConfig<typeof removeHubRegistry>
}

export const useRemoveHubRegistry = ({mutationConfig}: UseRemoveHubRegistryOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getHubRegistriesQueryOptions().queryKey})
      queryClient.invalidateQueries({queryKey: getHubEntriesQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: removeHubRegistry,
  })
}
