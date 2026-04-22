import {useInfiniteQuery} from '@tanstack/react-query'

import {
  ContextTreeEvents,
  type ContextTreeGetHistoryRequest,
  type ContextTreeGetHistoryResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const getContextHistory = (data: ContextTreeGetHistoryRequest): Promise<ContextTreeGetHistoryResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ContextTreeGetHistoryResponse, ContextTreeGetHistoryRequest>(
    ContextTreeEvents.GET_HISTORY,
    data,
  )
}

type UseGetContextHistoryOptions = {
  enabled?: boolean
  path: string
}

export const useGetContextHistory = ({enabled = true, path}: UseGetContextHistoryOptions) =>
  useInfiniteQuery({
    enabled: enabled && Boolean(path),
    getNextPageParam: (lastPage: ContextTreeGetHistoryResponse) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam}) => getContextHistory({cursor: pageParam, path}),
    queryKey: ['contextTree', 'history', path],
  })
