import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {
  type IVcConfigRequest,
  type IVcConfigResponse,
  VcEvents,
} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcConfig = (request: IVcConfigRequest): Promise<IVcConfigResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcConfigResponse>(VcEvents.CONFIG, request)
}

type UseExecuteVcConfigOptions = {
  mutationConfig?: MutationConfig<typeof executeVcConfig>
}

export const useExecuteVcConfig = ({mutationConfig}: UseExecuteVcConfigOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcConfig,
  })
