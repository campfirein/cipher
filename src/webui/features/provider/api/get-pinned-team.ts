import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {BillingEvents, type BillingGetPinnedTeamResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const PINNED_TEAM_QUERY_KEY = ['billing-pinned-team'] as const

export const getPinnedTeam = (): Promise<BillingGetPinnedTeamResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<BillingGetPinnedTeamResponse>(BillingEvents.GET_PINNED_TEAM)
}

export const getPinnedTeamQueryOptions = () =>
  queryOptions({
    queryFn: getPinnedTeam,
    queryKey: [...PINNED_TEAM_QUERY_KEY],
  })

type UseGetPinnedTeamOptions = {
  queryConfig?: QueryConfig<typeof getPinnedTeamQueryOptions>
}

export const useGetPinnedTeam = ({queryConfig}: UseGetPinnedTeamOptions = {}) =>
  useQuery({...queryConfig, ...getPinnedTeamQueryOptions()})
