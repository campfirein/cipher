import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {AuthEvents, type AuthGetStateResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const getAuthState = (): Promise<AuthGetStateResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<AuthGetStateResponse>(AuthEvents.GET_STATE)
}

export const getAuthStateQueryOptions = () =>
  queryOptions({
    queryFn: getAuthState,
    queryKey: ['auth', 'state'],
  })

type UseGetAuthStateOptions = {
  queryConfig?: QueryConfig<typeof getAuthStateQueryOptions>
}

export const useGetAuthState = ({queryConfig}: UseGetAuthStateOptions = {}) =>
  useQuery({
    ...getAuthStateQueryOptions(),
    ...queryConfig,
  })
