import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {HubEvents, type HubInstallRequest, type HubInstallResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {getHubEntriesQueryOptions} from './get-hub-entries'

export type InstallHubEntryDTO = {
  agent?: string
  entryId: string
  registry?: string
  scope?: 'global' | 'project'
}

export const installHubEntry = ({agent, entryId, registry, scope}: InstallHubEntryDTO): Promise<HubInstallResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<HubInstallResponse, HubInstallRequest>(
    HubEvents.INSTALL,
    {agent, entryId, registry, scope},
    {timeout: 60_000},
  )
}

type UseInstallHubEntryOptions = {
  mutationConfig?: MutationConfig<typeof installHubEntry>
}

export const useInstallHubEntry = ({mutationConfig}: UseInstallHubEntryOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getHubEntriesQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: installHubEntry,
  })
}
