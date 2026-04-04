import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {
  type IVcCommitRequest,
  type IVcCommitResponse,
  VcEvents,
} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcCommit = (request: IVcCommitRequest): Promise<IVcCommitResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcCommitResponse>(VcEvents.COMMIT, request)
}

type UseExecuteVcCommitOptions = {
  mutationConfig?: MutationConfig<typeof executeVcCommit>
}

export const useExecuteVcCommit = ({mutationConfig}: UseExecuteVcCommitOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcCommit,
  })
