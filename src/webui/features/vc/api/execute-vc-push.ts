import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type IVcPushRequest,
  type IVcPushResponse,
  VcEvents,
} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcPush = (request: IVcPushRequest = {}): Promise<IVcPushResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcPushResponse, IVcPushRequest>(VcEvents.PUSH, request)
}

type UseVcPushOptions = {
  mutationConfig?: MutationConfig<typeof executeVcPush>
}

export const useVcPush = ({mutationConfig}: UseVcPushOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcPush,
  })
}
