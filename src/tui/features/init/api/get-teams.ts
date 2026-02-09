import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {InitEvents, type InitGetTeamsResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const getTeams = (): Promise<InitGetTeamsResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<InitGetTeamsResponse>(InitEvents.GET_TEAMS)
}

export const getTeamsQueryOptions = () =>
  queryOptions({
    queryFn: getTeams,
    queryKey: ['init', 'teams'],
  })

type UseGetTeamsOptions = {
  queryConfig?: QueryConfig<typeof getTeamsQueryOptions>
}

export const useGetTeams = ({queryConfig}: UseGetTeamsOptions = {}) =>
  useQuery({
    ...getTeamsQueryOptions(),
    ...queryConfig,
  })
