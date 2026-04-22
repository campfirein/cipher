import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  ContextTreeEvents,
  type ContextTreeUpdateFileRequest,
  type ContextTreeUpdateFileResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export const updateContextFile = (data: ContextTreeUpdateFileRequest): Promise<ContextTreeUpdateFileResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ContextTreeUpdateFileResponse, ContextTreeUpdateFileRequest>(
    ContextTreeEvents.UPDATE_FILE,
    data,
  )
}

type UseUpdateContextFileOptions = {
  mutationConfig?: MutationConfig<typeof updateContextFile>
}

export const useUpdateContextFile = ({mutationConfig}: UseUpdateContextFileOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: ['contextTree']})
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: updateContextFile,
  })
}
