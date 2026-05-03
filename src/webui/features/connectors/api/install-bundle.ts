import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {Agent} from '../../../../shared/types/agent'
import type {MutationConfig} from '../../../lib/react-query'

import {
  ConnectorEvents,
  type ConnectorInstallBundleRequest,
  type ConnectorInstallBundleResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {getConnectorsQueryOptions} from './get-connectors'

export type InstallBundleDTO = {
  agentId: Agent
}

export const installBundle = ({agentId}: InstallBundleDTO): Promise<ConnectorInstallBundleResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ConnectorInstallBundleResponse, ConnectorInstallBundleRequest>(
    ConnectorEvents.INSTALL_BUNDLE,
    {agentId},
  )
}

type UseInstallBundleOptions = {
  mutationConfig?: MutationConfig<typeof installBundle>
}

export const useInstallBundle = ({mutationConfig}: UseInstallBundleOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getConnectorsQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: installBundle,
  })
}
