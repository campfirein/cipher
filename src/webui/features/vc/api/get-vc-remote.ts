import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query'

import {
  type IVcRemoteRequest,
  type IVcRemoteResponse,
  VcErrorCode,
  VcEvents,
} from '../../../../shared/transport/events/vc-events'
import {hasCode} from '../../../lib/transport-error'
import {useTransportStore} from '../../../stores/transport-store'

export type VcRemoteShow = {
  gitInitialized: boolean
  url: string | undefined
}

export const getVcRemote = async (): Promise<VcRemoteShow> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) throw new Error('Not connected')

  try {
    const response = await apiClient.request<IVcRemoteResponse, IVcRemoteRequest>(VcEvents.REMOTE, {
      subcommand: 'show',
    })
    return {gitInitialized: true, url: response.url}
  } catch (error) {
    if (hasCode(error) && error.code === VcErrorCode.GIT_NOT_INITIALIZED) {
      return {gitInitialized: false, url: undefined}
    }

    throw error
  }
}

export const getVcRemoteQueryOptions = () =>
  queryOptions({
    queryFn: getVcRemote,
    queryKey: ['vc', 'remote'],
    staleTime: 5000,
  })

type UseGetVcRemoteOptions = {
  queryConfig?: QueryConfig<typeof getVcRemoteQueryOptions>
}

export const useGetVcRemote = ({queryConfig}: UseGetVcRemoteOptions = {}) =>
  useQuery({
    ...getVcRemoteQueryOptions(),
    ...queryConfig,
  })
