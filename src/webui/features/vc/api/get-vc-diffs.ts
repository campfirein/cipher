import {keepPreviousData, queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {
  type IVcDiffsRequest,
  type IVcDiffsResponse,
  type VcDiffSide,
  VcEvents,
} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'

export const getVcDiffs = (request: IVcDiffsRequest): Promise<IVcDiffsResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcDiffsResponse, IVcDiffsRequest>(VcEvents.DIFFS, request)
}

// WebUI only uses the {paths, side} variant of IVcDiffsRequest (mode is CLI/TUI only).
type VcDiffsPathsRequest = Extract<IVcDiffsRequest, {paths: string[]}>

export const getVcDiffsQueryOptions = (request: VcDiffsPathsRequest) =>
  queryOptions({
    placeholderData: keepPreviousData,
    queryFn: () => getVcDiffs(request),
    queryKey: ['vc', 'diffs', request.side, ...request.paths],
    staleTime: 0,
  })

type UseGetVcDiffsOptions = {
  enabled?: boolean
  paths: string[]
  queryConfig?: QueryConfig<typeof getVcDiffsQueryOptions>
  side: VcDiffSide
}

export const useGetVcDiffs = ({enabled = true, paths, queryConfig, side}: UseGetVcDiffsOptions) =>
  useQuery({
    ...getVcDiffsQueryOptions({paths, side}),
    enabled: enabled && paths.length > 0,
    ...queryConfig,
  })
