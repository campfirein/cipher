import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {
  type IVcPushRequest,
  type IVcPushResponse,
  VcEvents,
} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcPush = (request: IVcPushRequest): Promise<IVcPushResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcPushResponse>(VcEvents.PUSH, request)
}

type UseExecuteVcPushOptions = {
  mutationConfig?: MutationConfig<typeof executeVcPush>
}

export const useExecuteVcPush = ({mutationConfig}: UseExecuteVcPushOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcPush,
  })
