import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {ModelEvents, type ModelListRequest, type ModelListResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export type GetModelsDTO = {
  providerId: string
}

export const getModels = ({providerId}: GetModelsDTO): Promise<ModelListResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ModelListResponse, ModelListRequest>(ModelEvents.LIST, {providerId})
}

export const getModelsQueryOptions = (providerId: string) =>
  queryOptions({
    queryFn: () => getModels({providerId}),
    queryKey: ['models', providerId],
  })

type UseGetModelsOptions = {
  providerId: string
  queryConfig?: QueryConfig<typeof getModelsQueryOptions>
}

export const useGetModels = ({providerId, queryConfig}: UseGetModelsOptions) =>
  useQuery({
    ...getModelsQueryOptions(providerId),
    ...queryConfig,
  })
