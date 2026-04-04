import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {type IVcInitResponse, VcEvents} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcInit = (): Promise<IVcInitResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcInitResponse>(VcEvents.INIT, {})
}

type UseExecuteVcInitOptions = {
  mutationConfig?: MutationConfig<typeof executeVcInit>
}

export const useExecuteVcInit = ({mutationConfig}: UseExecuteVcInitOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcInit,
  })
