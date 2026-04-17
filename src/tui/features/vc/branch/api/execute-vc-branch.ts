import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {
  type IVcBranchRequest,
  type IVcBranchResponse,
  VcEvents,
} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcBranch = (request: IVcBranchRequest): Promise<IVcBranchResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcBranchResponse>(VcEvents.BRANCH, request)
}

type UseExecuteVcBranchOptions = {
  mutationConfig?: MutationConfig<typeof executeVcBranch>
}

export const useExecuteVcBranch = ({mutationConfig}: UseExecuteVcBranchOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcBranch,
  })
