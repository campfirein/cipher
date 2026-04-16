import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {type IVcBranchResponse, type VcBranch, VcEvents} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'

export const getVcBranches = (): Promise<VcBranch[]> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient
    .request<IVcBranchResponse>(VcEvents.BRANCH, {action: 'list', all: true})
    .then((response) => {
      if (response.action !== 'list') {
        throw new Error(`Unexpected branch response action: ${response.action}`)
      }

      return response.branches
    })
}

export const getVcBranchesQueryOptions = () =>
  queryOptions({
    queryFn: getVcBranches,
    queryKey: ['vc', 'branches', 'all'],
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 5000,
  })

type UseGetVcBranchesOptions = {
  queryConfig?: QueryConfig<typeof getVcBranchesQueryOptions>
}

export const useGetVcBranches = ({queryConfig}: UseGetVcBranchesOptions = {}) =>
  useQuery({
    ...getVcBranchesQueryOptions(),
    ...queryConfig,
  })
