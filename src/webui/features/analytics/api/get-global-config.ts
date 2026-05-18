import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {
  GlobalConfigEvents,
  type GlobalConfigGetResponse,
} from '../../../../shared/transport/events/global-config-events.js'
import {useTransportStore} from '../../../stores/transport-store'

export const getGlobalConfig = async (): Promise<GlobalConfigGetResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) throw new Error('Not connected')
  return apiClient.request<GlobalConfigGetResponse, void>(GlobalConfigEvents.GET)
}

export const getGlobalConfigQueryOptions = () =>
  queryOptions({
    queryFn: getGlobalConfig,
    queryKey: ['globalConfig'],
    staleTime: 5000,
  })

type UseGetGlobalConfigOptions = {
  queryConfig?: QueryConfig<typeof getGlobalConfigQueryOptions>
}

export const useGetGlobalConfig = ({queryConfig}: UseGetGlobalConfigOptions = {}) =>
  useQuery({
    ...getGlobalConfigQueryOptions(),
    ...queryConfig,
  })
