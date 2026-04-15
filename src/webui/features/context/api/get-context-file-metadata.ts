import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {
  ContextTreeEvents,
  type ContextTreeGetFileMetadataRequest,
  type ContextTreeGetFileMetadataResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getContextFileMetadata = (
  data: ContextTreeGetFileMetadataRequest,
): Promise<ContextTreeGetFileMetadataResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ContextTreeGetFileMetadataResponse, ContextTreeGetFileMetadataRequest>(
    ContextTreeEvents.GET_FILE_METADATA,
    data,
  )
}

export const getContextFileMetadataQueryOptions = (paths: string[]) =>
  queryOptions({
    queryFn: () => getContextFileMetadata({paths}),
    queryKey: ['contextTree', 'fileMetadata', ...[...paths].sort()],
  })

type UseGetContextFileMetadataOptions = {
  enabled?: boolean
  paths: string[]
  queryConfig?: QueryConfig<typeof getContextFileMetadataQueryOptions>
}

export const useGetContextFileMetadata = ({enabled = true, paths, queryConfig}: UseGetContextFileMetadataOptions) =>
  useQuery({
    ...getContextFileMetadataQueryOptions(paths),
    enabled: enabled && paths.length > 0,
    ...queryConfig,
  })
