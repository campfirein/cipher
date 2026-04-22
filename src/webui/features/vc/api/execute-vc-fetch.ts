import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type IVcFetchRequest,
  type IVcFetchResponse,
  VcEvents,
} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcBranchesQueryOptions} from './get-vc-branches'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcFetch = (request: IVcFetchRequest = {}): Promise<IVcFetchResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcFetchResponse, IVcFetchRequest>(VcEvents.FETCH, request)
}

type UseVcFetchOptions = {
  mutationConfig?: MutationConfig<typeof executeVcFetch>
}

export const useVcFetch = ({mutationConfig}: UseVcFetchOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      queryClient.invalidateQueries({queryKey: getVcBranchesQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcFetch,
  })
}
