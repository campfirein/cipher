import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {type IVcMergeRequest, type IVcMergeResponse, VcEvents} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcMergeAbort = (): Promise<IVcMergeResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcMergeResponse, IVcMergeRequest>(VcEvents.MERGE, {action: 'abort'})
}

type UseVcMergeAbortOptions = {
  mutationConfig?: MutationConfig<typeof executeVcMergeAbort>
}

export const useVcMergeAbort = ({mutationConfig}: UseVcMergeAbortOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      // Aborting reverts the working tree, so cached single + batch diffs are stale.
      queryClient.invalidateQueries({queryKey: ['vc', 'diff']})
      queryClient.invalidateQueries({queryKey: ['vc', 'diffs']})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcMergeAbort,
  })
}
