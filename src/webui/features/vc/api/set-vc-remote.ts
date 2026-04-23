import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  type IVcRemoteRequest,
  type IVcRemoteResponse,
  VcEvents,
  type VcRemoteSubcommand,
} from '../../../../shared/transport/events/vc-events'
import {useTransportStore} from '../../../stores/transport-store'
import {getVcRemoteQueryOptions} from './get-vc-remote'

export type SetVcRemoteInput = {
  subcommand: Exclude<VcRemoteSubcommand, 'show'>
  url: string
}

export const setVcRemote = (input: SetVcRemoteInput): Promise<IVcRemoteResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))
  const request: IVcRemoteRequest = {subcommand: input.subcommand, url: input.url}
  return apiClient.request<IVcRemoteResponse, IVcRemoteRequest>(VcEvents.REMOTE, request)
}

type UseSetVcRemoteOptions = {
  mutationConfig?: MutationConfig<typeof setVcRemote>
}

export const useSetVcRemote = ({mutationConfig}: UseSetVcRemoteOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...rest} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getVcRemoteQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...rest,
    mutationFn: setVcRemote,
  })
}
