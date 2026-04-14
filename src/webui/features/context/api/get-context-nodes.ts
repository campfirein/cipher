import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {
  ContextTreeEvents,
  type ContextTreeGetNodesRequest,
  type ContextTreeGetNodesResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getContextNodes = (data?: ContextTreeGetNodesRequest): Promise<ContextTreeGetNodesResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ContextTreeGetNodesResponse, ContextTreeGetNodesRequest>(ContextTreeEvents.GET_NODES, data)
}

export const getContextNodesQueryOptions = (branch?: string) =>
  queryOptions({
    queryFn: () => getContextNodes({branch}),
    queryKey: ['contextTree', 'nodes', branch],
  })

type UseGetContextNodesOptions = {
  branch?: string
  queryConfig?: QueryConfig<typeof getContextNodesQueryOptions>
}

export const useGetContextNodes = ({branch, queryConfig}: UseGetContextNodesOptions = {}) =>
  useQuery({
    ...getContextNodesQueryOptions(branch),
    ...queryConfig,
  })
