import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {ProviderEvents, type ProviderListResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getProviders = (): Promise<ProviderListResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ProviderListResponse>(ProviderEvents.LIST)
}

export const getProvidersQueryOptions = () =>
  queryOptions({
    queryFn: getProviders,
    queryKey: ['providers'],
  })

type UseGetProvidersOptions = {
  queryConfig?: QueryConfig<typeof getProvidersQueryOptions>
}

export const useGetProviders = ({queryConfig}: UseGetProvidersOptions = {}) =>
  useQuery({
    ...getProvidersQueryOptions(),
    ...queryConfig,
  })
