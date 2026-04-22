import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {AuthScheme} from '../../../../shared/transport/types/auth-scheme'
import type {MutationConfig} from '../../../lib/react-query'

import {
  HubEvents,
  type HubRegistryAddRequest,
  type HubRegistryAddResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {getHubEntriesQueryOptions} from './get-hub-entries'
import {getHubRegistriesQueryOptions} from './list-hub-registries'

export type AddHubRegistryDTO = {
  authScheme?: AuthScheme
  headerName?: string
  name: string
  token?: string
  url: string
}

export const addHubRegistry = ({authScheme, headerName, name, token, url}: AddHubRegistryDTO): Promise<HubRegistryAddResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<HubRegistryAddResponse, HubRegistryAddRequest>(HubEvents.REGISTRY_ADD, {
    authScheme,
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
