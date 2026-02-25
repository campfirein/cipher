import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {
  PushEvents,
  type PushPrepareRequest,
  type PushPrepareResponse,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export type PreparePushDTO = {
  branch: string
}

export const preparePush = ({branch}: PreparePushDTO): Promise<PushPrepareResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<PushPrepareResponse, PushPrepareRequest>(PushEvents.PREPARE, {branch})
}

export const preparePushQueryOptions = (branch: string) =>
  queryOptions({
    queryFn: () => preparePush({branch}),
    queryKey: ['push', 'prepare', branch],
  })

type UsePreparePushOptions = {
  branch: string
  queryConfig?: QueryConfig<typeof preparePushQueryOptions>
}

export const usePreparePush = ({branch, queryConfig}: UsePreparePushOptions) =>
  useQuery({
    ...preparePushQueryOptions(branch),
    ...queryConfig,
  })
