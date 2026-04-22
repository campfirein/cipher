import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {Agent} from '../../../../shared/types/agent'
import type {ConnectorType} from '../../../../shared/types/connector-type'
import type {MutationConfig} from '../../../lib/react-query'

import {
  ConnectorEvents,
  type ConnectorInstallRequest,
  type ConnectorInstallResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {getConnectorsQueryOptions} from './get-connectors'

export type InstallConnectorDTO = {
  agentId: Agent
  connectorType: ConnectorType
}

export const installConnector = ({agentId, connectorType}: InstallConnectorDTO): Promise<ConnectorInstallResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ConnectorInstallResponse, ConnectorInstallRequest>(ConnectorEvents.INSTALL, {
    agentId,
    connectorType,
  })
}

type UseInstallConnectorOptions = {
  mutationConfig?: MutationConfig<typeof installConnector>
}

export const useInstallConnector = ({mutationConfig}: UseInstallConnectorOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getConnectorsQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: installConnector,
  })
}
