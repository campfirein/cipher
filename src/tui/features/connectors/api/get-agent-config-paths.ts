import {queryOptions, useQuery} from '@tanstack/react-query'

import type {Agent} from '../../../../shared/types/agent.js'
import type {QueryConfig} from '../../../lib/react-query.js'

import {
  ConnectorEvents,
  type ConnectorGetAgentConfigPathsRequest,
  type ConnectorGetAgentConfigPathsResponse,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const getAgentConfigPaths = (agentId: Agent): Promise<ConnectorGetAgentConfigPathsResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ConnectorGetAgentConfigPathsResponse, ConnectorGetAgentConfigPathsRequest>(
    ConnectorEvents.GET_AGENT_CONFIG_PATHS,
    {agentId},
  )
}

export const getAgentConfigPathsQueryOptions = (agentId: Agent) =>
  queryOptions({
    queryFn: () => getAgentConfigPaths(agentId),
    queryKey: ['connectors', 'agentConfigPaths', agentId],
  })

type UseGetAgentConfigPathsOptions = {
  agentId: Agent
  queryConfig?: QueryConfig<typeof getAgentConfigPathsQueryOptions>
}

export const useGetAgentConfigPaths = ({agentId, queryConfig}: UseGetAgentConfigPathsOptions) =>
  useQuery({
    ...getAgentConfigPathsQueryOptions(agentId),
    ...queryConfig,
  })
