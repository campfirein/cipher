import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {type IVcMergeRequest, type IVcMergeResponse, VcEvents} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcMergeContinue = (request: {message: string}): Promise<IVcMergeResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcMergeResponse, IVcMergeRequest>(VcEvents.MERGE, {
    action: 'continue',
    message: request.message,
  })
}

type UseVcMergeContinueOptions = {
  mutationConfig?: MutationConfig<typeof executeVcMergeContinue>
}

export const useVcMergeContinue = ({mutationConfig}: UseVcMergeContinueOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      // Finalizing the merge changes HEAD; cached diffs may be stale.
      queryClient.invalidateQueries({queryKey: ['vc', 'diff']})
      queryClient.invalidateQueries({queryKey: ['vc', 'diffs']})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcMergeContinue,
  })
}
