import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {
  ContextTreeEvents,
  type ContextTreeGetFileRequest,
  type ContextTreeGetFileResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getContextFile = (data: ContextTreeGetFileRequest): Promise<ContextTreeGetFileResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ContextTreeGetFileResponse, ContextTreeGetFileRequest>(ContextTreeEvents.GET_FILE, data)
}

export const getContextFileQueryOptions = ({branch, path}: {branch?: string; path: string}) =>
  queryOptions({
    queryFn: () => getContextFile({branch, path}),
    queryKey: ['contextTree', 'file', branch, path],
  })

type UseGetContextFileOptions = {
  branch?: string
  path: string
  queryConfig?: QueryConfig<typeof getContextFileQueryOptions>
}

export const useGetContextFile = ({branch, path, queryConfig}: UseGetContextFileOptions) =>
  useQuery({
    ...getContextFileQueryOptions({branch, path}),
    enabled: Boolean(path),
    ...queryConfig,
  })
