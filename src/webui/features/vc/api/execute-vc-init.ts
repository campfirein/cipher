import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {type IVcInitResponse, VcEvents} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcBranchesQueryOptions} from './get-vc-branches'
import {getVcStatusQueryOptions} from './get-vc-status'

export const executeVcInit = (): Promise<IVcInitResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcInitResponse>(VcEvents.INIT)
}

type UseVcInitOptions = {
  mutationConfig?: MutationConfig<typeof executeVcInit>
}

export const useVcInit = ({mutationConfig}: UseVcInitOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcStatusQueryOptions().queryKey})
      queryClient.invalidateQueries({queryKey: getVcBranchesQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: executeVcInit,
  })
}
