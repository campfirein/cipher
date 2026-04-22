import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type IVcPullRequest,
  type IVcPullResponse,
  VcEvents,
} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcBranchesQueryOptions} from './get-vc-branches'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcPull = (request: IVcPullRequest = {}): Promise<IVcPullResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcPullResponse, IVcPullRequest>(VcEvents.PULL, request)
}

type UseVcPullOptions = {
  mutationConfig?: MutationConfig<typeof executeVcPull>
}

export const useVcPull = ({mutationConfig}: UseVcPullOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      queryClient.invalidateQueries({queryKey: getVcBranchesQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcPull,
  })
}
