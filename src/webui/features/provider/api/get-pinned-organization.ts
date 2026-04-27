import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {BillingEvents, type BillingGetPinnedOrganizationResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const PINNED_ORGANIZATION_QUERY_KEY = ['billing-pinned-organization'] as const

export const getPinnedOrganization = (): Promise<BillingGetPinnedOrganizationResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<BillingGetPinnedOrganizationResponse>(BillingEvents.GET_PINNED_ORGANIZATION)
}

export const getPinnedOrganizationQueryOptions = () =>
  queryOptions({
    queryFn: getPinnedOrganization,
    queryKey: [...PINNED_ORGANIZATION_QUERY_KEY],
  })

type UseGetPinnedOrganizationOptions = {
  queryConfig?: QueryConfig<typeof getPinnedOrganizationQueryOptions>
}

export const useGetPinnedOrganization = ({queryConfig}: UseGetPinnedOrganizationOptions = {}) =>
  useQuery({...queryConfig, ...getPinnedOrganizationQueryOptions()})
