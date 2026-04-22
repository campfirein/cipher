import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {ConfigEvents, type ConfigGetEnvironmentResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getEnvironmentConfig = (): Promise<ConfigGetEnvironmentResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request(ConfigEvents.GET_ENVIRONMENT)
}

export const getEnvironmentConfigQueryOptions = () =>
  queryOptions({
    queryFn: getEnvironmentConfig,
    queryKey: ['config', 'environment'],
    staleTime: Infinity,
  })

type UseGetEnvironmentConfigOptions = {
  queryConfig?: QueryConfig<typeof getEnvironmentConfigQueryOptions>
}

export const useGetEnvironmentConfig = ({queryConfig}: UseGetEnvironmentConfigOptions = {}) =>
  useQuery({...getEnvironmentConfigQueryOptions(), ...queryConfig})
