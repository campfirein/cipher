import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {HubEvents, type HubListResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getHubEntries = (): Promise<HubListResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<HubListResponse>(HubEvents.LIST, undefined, {timeout: 60_000})
}

export const getHubEntriesQueryOptions = () =>
  queryOptions({
    queryFn: getHubEntries,
    queryKey: ['hub', 'list'],
  })

type UseGetHubEntriesOptions = {
  queryConfig?: QueryConfig<typeof getHubEntriesQueryOptions>
}

export const useGetHubEntries = ({queryConfig}: UseGetHubEntriesOptions = {}) =>
  useQuery({
    ...getHubEntriesQueryOptions(),
    ...queryConfig,
  })
