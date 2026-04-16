import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type IVcAddRequest,
  type IVcAddResponse,
  type IVcCommitRequest,
  type IVcCommitResponse,
  VcEvents,
} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcStatusQueryOptions} from './get-vc-status'

type CommitArgs = {
  addAll?: boolean
  filePaths?: string[]
  message: string
}

async function addAndCommit({addAll, filePaths, message}: CommitArgs): Promise<IVcCommitResponse> {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) throw new Error('Not connected')

  if (addAll || (filePaths && filePaths.length > 0)) {
    const addRequest: IVcAddRequest = filePaths ? {filePaths} : {}
    await apiClient.request<IVcAddResponse, IVcAddRequest>(VcEvents.ADD, addRequest)
  }

  return apiClient.request<IVcCommitResponse, IVcCommitRequest>(VcEvents.COMMIT, {message})
}

type UseVcCommitOptions = {
  mutationConfig?: MutationConfig<typeof addAndCommit>
}

export const useVcCommit = ({mutationConfig}: UseVcCommitOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: addAndCommit,
  })
}
