import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {LocationsEvents, type LocationsGetResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getProjectList = (): Promise<LocationsGetResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request(LocationsEvents.GET)
}

export const getProjectListQueryOptions = () =>
  queryOptions({
    queryFn: getProjectList,
    queryKey: ['projects'],
  })

type UseGetProjectListOptions = {
  queryConfig?: QueryConfig<typeof getProjectListQueryOptions>
}

export const useGetProjectList = ({queryConfig}: UseGetProjectListOptions = {}) =>
  useQuery({
    ...getProjectListQueryOptions(),
    ...queryConfig,
  })
