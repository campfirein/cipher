import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {type IVcStatusResponse, VcEvents} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcStatus = (): Promise<IVcStatusResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcStatusResponse>(VcEvents.STATUS, {})
}

type UseExecuteVcStatusOptions = {
  mutationConfig?: MutationConfig<typeof executeVcStatus>
}

export const useExecuteVcStatus = ({mutationConfig}: UseExecuteVcStatusOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcStatus,
  })
