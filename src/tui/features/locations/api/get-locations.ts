import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {LocationsEvents, type LocationsGetResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const getLocations = (): Promise<LocationsGetResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<LocationsGetResponse>(LocationsEvents.GET)
}

export const getLocationsQueryOptions = () =>
  queryOptions({
    queryFn: getLocations,
    queryKey: ['locations'],
  })

type UseGetLocationsOptions = {
  queryConfig?: QueryConfig<typeof getLocationsQueryOptions>
}

export const useGetLocations = ({queryConfig}: UseGetLocationsOptions = {}) =>
  useQuery({
    ...getLocationsQueryOptions(),
    ...queryConfig,
  })
