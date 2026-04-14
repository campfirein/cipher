import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {type IVcLogRequest, type IVcLogResponse, VcEvents} from '../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const executeLog = (req: IVcLogRequest): Promise<IVcLogResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcLogResponse>(VcEvents.LOG, req)
}

type UseExecuteLogOptions = {
  mutationConfig?: MutationConfig<typeof executeLog>
}

export const useExecuteLog = ({mutationConfig}: UseExecuteLogOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeLog,
  })
