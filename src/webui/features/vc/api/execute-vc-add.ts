import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {type IVcAddRequest, type IVcAddResponse, VcEvents} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcAdd = (request: IVcAddRequest = {}): Promise<IVcAddResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcAddResponse, IVcAddRequest>(VcEvents.ADD, request)
}

type UseVcAddOptions = {
  mutationConfig?: MutationConfig<typeof executeVcAdd>
}

export const useVcAdd = ({mutationConfig}: UseVcAddOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcAdd,
  })
}
