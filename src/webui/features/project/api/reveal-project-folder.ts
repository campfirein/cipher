import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  LocationsEvents,
  type LocationsRevealRequest,
  type LocationsRevealResponse,
} from '../../../../shared/transport/events/locations-events'
import {useTransportStore} from '../../../stores/transport-store'

export const revealProjectFolder = (input: LocationsRevealRequest): Promise<LocationsRevealResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))
  return apiClient.request<LocationsRevealResponse, LocationsRevealRequest>(LocationsEvents.REVEAL, input)
}

type UseRevealProjectFolderOptions = {
  mutationConfig?: MutationConfig<typeof revealProjectFolder>
}

export const useRevealProjectFolder = ({mutationConfig}: UseRevealProjectFolderOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: revealProjectFolder,
  })
