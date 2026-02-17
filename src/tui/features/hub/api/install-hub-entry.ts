import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {HubEvents, type HubInstallRequest, type HubInstallResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getHubEntriesQueryOptions} from './get-hub-entries.js'

export type InstallHubEntryDTO = {
  agent?: string
  entryId: string
}

export const installHubEntry = ({agent, entryId}: InstallHubEntryDTO): Promise<HubInstallResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<HubInstallResponse, HubInstallRequest>(HubEvents.INSTALL, {agent, entryId})
}

type UseInstallHubEntryOptions = {
  mutationConfig?: MutationConfig<typeof installHubEntry>
}

export const useInstallHubEntry = ({mutationConfig}: UseInstallHubEntryOptions = {}) => {
  const queryClient = useQueryClient()

  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({
        queryKey: getHubEntriesQueryOptions().queryKey,
      })
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: installHubEntry,
  })
}
