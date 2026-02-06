import {useMutation} from '@tanstack/react-query'

import type {Agent} from '../../../../shared/types/agent.js'
import type {ConnectorType} from '../../../../shared/types/connector-type.js'
import type {MutationConfig} from '../../../lib/react-query.js'

import {
  InitEvents,
  type InitExecuteRequest,
  type InitExecuteResponse,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export type ExecuteInitDTO = {
  agentId: Agent
  connectorType: ConnectorType
  force?: boolean
  spaceId: string
  teamId: string
}

export const executeInit = ({
  agentId,
  connectorType,
  force,
  spaceId,
  teamId,
}: ExecuteInitDTO): Promise<InitExecuteResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<InitExecuteResponse, InitExecuteRequest>(InitEvents.EXECUTE, {
    agentId,
    connectorType,
    force,
    spaceId,
    teamId,
  })
}

type UseExecuteInitOptions = {
  mutationConfig?: MutationConfig<typeof executeInit>
}

export const useExecuteInit = ({mutationConfig}: UseExecuteInitOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: executeInit,
  })
