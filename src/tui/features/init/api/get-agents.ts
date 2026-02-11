import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {InitEvents, type InitGetAgentsResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const getAgents = (): Promise<InitGetAgentsResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<InitGetAgentsResponse>(InitEvents.GET_AGENTS)
}

export const getAgentsQueryOptions = () =>
  queryOptions({
    queryFn: getAgents,
    queryKey: ['init', 'agents'],
  })

type UseGetAgentsOptions = {
  queryConfig?: QueryConfig<typeof getAgentsQueryOptions>
}

export const useGetAgents = ({queryConfig}: UseGetAgentsOptions = {}) =>
  useQuery({
    ...getAgentsQueryOptions(),
    ...queryConfig,
  })
