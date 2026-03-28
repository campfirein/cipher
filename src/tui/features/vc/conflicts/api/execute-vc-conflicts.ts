import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../../lib/react-query.js'

import {type IVcConflictsResponse, VcEvents} from '../../../../../shared/transport/events/vc-events.js'
import {useTransportStore} from '../../../../stores/transport-store.js'

export const executeVcConflicts = (): Promise<IVcConflictsResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<IVcConflictsResponse>(VcEvents.CONFLICTS, {})
}

type UseExecuteVcConflictsOptions = {
  mutationConfig?: MutationConfig<typeof executeVcConflicts>
}

export const useExecuteVcConflicts = ({mutationConfig}: UseExecuteVcConflictsOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeVcConflicts,
  })
