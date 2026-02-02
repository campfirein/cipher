import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {ConnectorEvents, type ConnectorInstallRequest, type ConnectorInstallResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getConnectorsQueryOptions} from './get-connectors.js'

export type InstallConnectorDTO = {
  agentId: string
  connectorType: string
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
      queryClient.invalidateQueries({
        queryKey: getConnectorsQueryOptions().queryKey,
      })
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: installConnector,
  })
}
