import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {
  HubEvents,
  type HubRegistryAddRequest,
  type HubRegistryAddResponse,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getHubEntriesQueryOptions} from './get-hub-entries.js'
import {getHubRegistriesQueryOptions} from './list-hub-registries.js'

export type AddHubRegistryDTO = {
  authScheme?: string
  headerName?: string
  name: string
  token?: string
  url: string
}

export const addHubRegistry = ({authScheme, headerName, name, token, url}: AddHubRegistryDTO): Promise<HubRegistryAddResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<HubRegistryAddResponse, HubRegistryAddRequest>(HubEvents.REGISTRY_ADD, {
    authScheme: authScheme as HubRegistryAddRequest['authScheme'],
    headerName,
    name,
    token,
    url,
  })
}

type UseAddHubRegistryOptions = {
  mutationConfig?: MutationConfig<typeof addHubRegistry>
}

export const useAddHubRegistry = ({mutationConfig}: UseAddHubRegistryOptions = {}) => {
  const queryClient = useQueryClient()

  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getHubRegistriesQueryOptions().queryKey})
      queryClient.invalidateQueries({queryKey: getHubEntriesQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: addHubRegistry,
  })
}
