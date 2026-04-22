import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {
  ModelEvents,
  type ModelListByProvidersRequest,
  type ModelListByProvidersResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export type GetModelsByProvidersDTO = {
  providerIds: string[]
}

export const getModelsByProviders = ({providerIds}: GetModelsByProvidersDTO): Promise<ModelListByProvidersResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ModelListByProvidersResponse, ModelListByProvidersRequest>(ModelEvents.LIST_BY_PROVIDERS, {
    providerIds,
  })
}

export const getModelsByProvidersQueryOptions = (providerIds: string[]) =>
  queryOptions({
    queryFn: () => getModelsByProviders({providerIds}),
    queryKey: ['modelsByProviders', ...providerIds],
  })

type UseGetModelsByProvidersOptions = {
  providerIds: string[]
  queryConfig?: QueryConfig<typeof getModelsByProvidersQueryOptions>
}

export const useGetModelsByProviders = ({providerIds, queryConfig}: UseGetModelsByProvidersOptions) =>
  useQuery({
    ...getModelsByProvidersQueryOptions(providerIds),
    ...queryConfig,
  })
