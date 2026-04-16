import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {type IVcBranchResponse, VcEvents} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcBranchesQueryOptions} from './get-vc-branches'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcBranchSetUpstream = async (upstream: string): Promise<IVcBranchResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) throw new Error('Not connected')

  return apiClient.request<IVcBranchResponse>(VcEvents.BRANCH, {action: 'set-upstream', upstream})
}

type UseVcBranchSetUpstreamOptions = {
  mutationConfig?: MutationConfig<typeof executeVcBranchSetUpstream>
}

export const useVcBranchSetUpstream = ({mutationConfig}: UseVcBranchSetUpstreamOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      queryClient.invalidateQueries({queryKey: getVcBranchesQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcBranchSetUpstream,
  })
}
