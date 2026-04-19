import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {
  type IVcDiffRequest,
  type IVcDiffResponse,
  type VcDiffSide,
  VcEvents,
} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'

export const getVcDiff = (request: IVcDiffRequest): Promise<IVcDiffResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcDiffResponse, IVcDiffRequest>(VcEvents.DIFF, request)
}

export const getVcDiffQueryOptions = (request: IVcDiffRequest) =>
  queryOptions({
    queryFn: () => getVcDiff(request),
    queryKey: ['vc', 'diff', request.path, request.side],
    staleTime: 0,
  })

type UseGetVcDiffOptions = {
  enabled?: boolean
  path: string
  queryConfig?: QueryConfig<ReturnType<typeof getVcDiffQueryOptions>>
  side: VcDiffSide
}

export const useGetVcDiff = ({enabled = true, path, queryConfig, side}: UseGetVcDiffOptions) =>
  useQuery({
    ...getVcDiffQueryOptions({path, side}),
    enabled: enabled && Boolean(path),
    ...queryConfig,
  })
