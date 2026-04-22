import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {ProviderEvents, type ProviderGetActiveResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getActiveProviderConfig = (): Promise<ProviderGetActiveResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ProviderGetActiveResponse>(ProviderEvents.GET_ACTIVE)
}

export const getActiveProviderConfigQueryOptions = () =>
  queryOptions({
    queryFn: getActiveProviderConfig,
    queryKey: ['getActiveProviderConfig'],
  })

type UseGetActiveProviderConfigOptions = {
  queryConfig?: QueryConfig<typeof getActiveProviderConfigQueryOptions>
}

export const useGetActiveProviderConfig = ({queryConfig}: UseGetActiveProviderConfigOptions = {}) =>
  useQuery({
    ...getActiveProviderConfigQueryOptions(),
    ...queryConfig,
  })
