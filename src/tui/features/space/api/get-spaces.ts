import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {SpaceEvents, type SpaceListResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const getSpaces = (): Promise<SpaceListResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<SpaceListResponse>(SpaceEvents.LIST)
}

export const getSpacesQueryOptions = () =>
  queryOptions({
    queryFn: getSpaces,
    queryKey: ['space', 'list'],
  })

type UseGetSpacesOptions = {
  queryConfig?: QueryConfig<typeof getSpacesQueryOptions>
}

export const useGetSpaces = ({queryConfig}: UseGetSpacesOptions = {}) =>
  useQuery({
    ...getSpacesQueryOptions(),
    ...queryConfig,
  })
