import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {
  PullEvents,
  type PullPrepareRequest,
  type PullPrepareResponse,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export type PreparePullDTO = {
  branch: string
}

export const preparePull = ({branch}: PreparePullDTO): Promise<PullPrepareResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<PullPrepareResponse, PullPrepareRequest>(PullEvents.PREPARE, {branch})
}

export const preparePullQueryOptions = (branch: string) =>
  queryOptions({
    queryFn: () => preparePull({branch}),
    queryKey: ['pull', 'prepare', branch],
  })

type UsePreparePullOptions = {
  branch: string
  queryConfig?: QueryConfig<typeof preparePullQueryOptions>
}

export const usePreparePull = ({branch, queryConfig}: UsePreparePullOptions) =>
  useQuery({
    ...preparePullQueryOptions(branch),
    ...queryConfig,
  })
