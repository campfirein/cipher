import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {StatusEvents, type StatusGetResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const getStatus = (): Promise<StatusGetResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<StatusGetResponse>(StatusEvents.GET)
}

export const getStatusQueryOptions = () =>
  queryOptions({
    queryFn: getStatus,
    queryKey: ['status'],
  })

type UseGetStatusOptions = {
  queryConfig?: QueryConfig<typeof getStatusQueryOptions>
}

export const useGetStatus = ({queryConfig}: UseGetStatusOptions = {}) =>
  useQuery({
    ...getStatusQueryOptions(),
    ...queryConfig,
  })
