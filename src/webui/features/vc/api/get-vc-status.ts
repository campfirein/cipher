import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {type IVcStatusResponse, VcEvents} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'

export const getVcStatus = (): Promise<IVcStatusResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcStatusResponse>(VcEvents.STATUS)
}

export const getVcStatusQueryOptions = () =>
  queryOptions({
    queryFn: getVcStatus,
    queryKey: ['vc', 'status'],
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    staleTime: 2000,
  })

type UseGetVcStatusOptions = {
  queryConfig?: QueryConfig<typeof getVcStatusQueryOptions>
}

export const useGetVcStatus = ({queryConfig}: UseGetVcStatusOptions = {}) =>
  useQuery({
    ...getVcStatusQueryOptions(),
    ...queryConfig,
  })
