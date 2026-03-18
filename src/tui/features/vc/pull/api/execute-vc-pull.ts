import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {type IVcPullResponse, VcEvents} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcPull = (): Promise<IVcPullResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcPullResponse>(VcEvents.PULL)
}

type UseExecuteVcPullOptions = {
  mutationConfig?: MutationConfig<typeof executeVcPull>
}

export const useExecuteVcPull = ({mutationConfig}: UseExecuteVcPullOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcPull,
  })
