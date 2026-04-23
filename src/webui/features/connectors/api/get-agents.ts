import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {ConnectorEvents, type ConnectorGetAgentsResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getAgents = (): Promise<ConnectorGetAgentsResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ConnectorGetAgentsResponse>(ConnectorEvents.GET_AGENTS)
}

export const getAgentsQueryOptions = () =>
  queryOptions({
    gcTime: Infinity,
    queryFn: getAgents,
    queryKey: ['connectors', 'agents'],
    staleTime: Infinity,
  })

type UseGetAgentsOptions = {
  queryConfig?: QueryConfig<typeof getAgentsQueryOptions>
}

export const useGetAgents = ({queryConfig}: UseGetAgentsOptions = {}) =>
  useQuery({
    ...getAgentsQueryOptions(),
    ...queryConfig,
  })
