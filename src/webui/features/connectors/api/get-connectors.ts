import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {ConnectorEvents, type ConnectorListResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getConnectors = (): Promise<ConnectorListResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ConnectorListResponse>(ConnectorEvents.LIST)
}

export const getConnectorsQueryOptions = () =>
  queryOptions({
    queryFn: getConnectors,
    queryKey: ['connectors', 'list'],
  })

type UseGetConnectorsOptions = {
  queryConfig?: QueryConfig<typeof getConnectorsQueryOptions>
}

export const useGetConnectors = ({queryConfig}: UseGetConnectorsOptions = {}) =>
  useQuery({
    ...getConnectorsQueryOptions(),
    ...queryConfig,
  })
