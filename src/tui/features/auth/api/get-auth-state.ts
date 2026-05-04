import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {AuthEvents, type AuthGetStateResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const getAuthState = (): Promise<AuthGetStateResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  // The daemon-side handler does a network round-trip to /user/me. Measured
  // p99 across multiple networks ranges 1.2-3.1s with occasional outliers,
  // so 4000ms gives ~1.3x headroom over the worst observed sample with
  // margin left for slower connections (mobile, international, VPN).
  // React Query retries once on failure for transient blips.
  return apiClient.request<AuthGetStateResponse>(AuthEvents.GET_STATE, undefined, {timeout: 4000})
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
