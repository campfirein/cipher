import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type IVcConfigRequest,
  type IVcConfigResponse,
  VcEvents,
} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcConfigQueryOptions} from './get-vc-config'

export const setVcConfig = (request: IVcConfigRequest): Promise<IVcConfigResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))
  return apiClient.request<IVcConfigResponse, IVcConfigRequest>(VcEvents.CONFIG, request)
}

type UseSetVcConfigOptions = {
  mutationConfig?: MutationConfig<typeof setVcConfig>
}

export const useSetVcConfig = ({mutationConfig}: UseSetVcConfigOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcConfigQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: setVcConfig,
  })
}
