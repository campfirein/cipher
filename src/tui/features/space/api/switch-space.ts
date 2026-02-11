import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {SpaceEvents, type SpaceSwitchRequest, type SpaceSwitchResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getSpacesQueryOptions} from './get-spaces.js'

export type SwitchSpaceDTO = {
  spaceId: string
}

export const switchSpace = ({spaceId}: SwitchSpaceDTO): Promise<SpaceSwitchResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<SpaceSwitchResponse, SpaceSwitchRequest>(SpaceEvents.SWITCH, {spaceId})
}

type UseSwitchSpaceOptions = {
  mutationConfig?: MutationConfig<typeof switchSpace>
}

export const useSwitchSpace = ({mutationConfig}: UseSwitchSpaceOptions = {}) => {
  const queryClient = useQueryClient()

  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({
        queryKey: getSpacesQueryOptions().queryKey,
      })
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: switchSpace,
  })
}
