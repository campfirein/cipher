import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {AuthEvents, type AuthGetStateResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getAuthState = (): Promise<AuthGetStateResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<AuthGetStateResponse>(AuthEvents.GET_STATE, undefined, {timeout: 500})
}

export const getAuthStateQueryOptions = () =>
  queryOptions({
    gcTime: 5 * 60 * 1000,
    queryFn: getAuthState,
    queryKey: ['auth', 'state'],
    staleTime: 60 * 1000,
  })

type UseGetAuthStateOptions = {
  queryConfig?: QueryConfig<typeof getAuthStateQueryOptions>
}

export const useGetAuthState = ({queryConfig}: UseGetAuthStateOptions = {}) =>
  useQuery({
    ...getAuthStateQueryOptions(),
    ...queryConfig,
  })
