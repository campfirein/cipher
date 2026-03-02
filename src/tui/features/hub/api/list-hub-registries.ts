import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {HubEvents, type HubRegistryListResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const getHubRegistries = (): Promise<HubRegistryListResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<HubRegistryListResponse>(HubEvents.REGISTRY_LIST)
}

export const getHubRegistriesQueryOptions = () =>
  queryOptions({
    queryFn: getHubRegistries,
    queryKey: ['hub', 'registries'],
  })

type UseGetHubRegistriesOptions = {
  queryConfig?: QueryConfig<typeof getHubRegistriesQueryOptions>
}

export const useGetHubRegistries = ({queryConfig}: UseGetHubRegistriesOptions = {}) =>
  useQuery({
    ...getHubRegistriesQueryOptions(),
    ...queryConfig,
  })
