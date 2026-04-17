import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {type IVcAddRequest, type IVcAddResponse, VcEvents} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcAdd = (request: IVcAddRequest): Promise<IVcAddResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcAddResponse>(VcEvents.ADD, request)
}

type UseExecuteVcAddOptions = {
  mutationConfig?: MutationConfig<typeof executeVcAdd>
}

export const useExecuteVcAdd = ({mutationConfig}: UseExecuteVcAddOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcAdd,
  })
