import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {type IVcBranchResponse, VcEvents} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcBranchesQueryOptions} from './get-vc-branches'

export const executeVcBranchDelete = async (name: string): Promise<IVcBranchResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) throw new Error('Not connected')

  return apiClient.request<IVcBranchResponse>(VcEvents.BRANCH, {action: 'delete', name})
}

type UseVcBranchDeleteOptions = {
  mutationConfig?: MutationConfig<typeof executeVcBranchDelete>
}

export const useVcBranchDelete = ({mutationConfig}: UseVcBranchDeleteOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcBranchesQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcBranchDelete,
  })
}
