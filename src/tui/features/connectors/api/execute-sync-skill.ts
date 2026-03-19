import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {ConnectorEvents, type ConnectorSyncResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const executeSyncSkill = (): Promise<ConnectorSyncResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ConnectorSyncResponse>(ConnectorEvents.SYNC)
}

type UseExecuteSyncSkillOptions = {
  mutationConfig?: MutationConfig<typeof executeSyncSkill>
}

export const useExecuteSyncSkill = ({mutationConfig}: UseExecuteSyncSkillOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeSyncSkill,
  })
