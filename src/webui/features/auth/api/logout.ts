import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {AuthEvents, type AuthLogoutResponse} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {getAuthStateQueryOptions} from './get-auth-state'

export const logout = (): Promise<AuthLogoutResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<AuthLogoutResponse>(AuthEvents.LOGOUT)
}

type UseLogoutOptions = {
  mutationConfig?: MutationConfig<typeof logout>
}

export const useLogout = ({mutationConfig}: UseLogoutOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getAuthStateQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: logout,
  })
}
