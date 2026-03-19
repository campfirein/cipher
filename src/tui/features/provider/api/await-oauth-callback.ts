import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {OAUTH_CALLBACK_TIMEOUT_MS} from '../../../../shared/constants/oauth.js'
import {
  type ProviderAwaitOAuthCallbackRequest,
  type ProviderAwaitOAuthCallbackResponse,
  ProviderEvents,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getProvidersQueryOptions} from './get-providers.js'

export type AwaitOAuthCallbackDTO = {
  providerId: string
}

export const awaitOAuthCallback = ({
  providerId,
}: AwaitOAuthCallbackDTO): Promise<ProviderAwaitOAuthCallbackResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ProviderAwaitOAuthCallbackResponse, ProviderAwaitOAuthCallbackRequest>(
    ProviderEvents.AWAIT_OAUTH_CALLBACK,
    {providerId},
    {timeout: OAUTH_CALLBACK_TIMEOUT_MS},
  )
}

type UseAwaitOAuthCallbackOptions = {
  mutationConfig?: MutationConfig<typeof awaitOAuthCallback>
}

export const useAwaitOAuthCallback = ({mutationConfig}: UseAwaitOAuthCallbackOptions = {}) => {
  const queryClient = useQueryClient()

  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({
        queryKey: getProvidersQueryOptions().queryKey,
      })
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: awaitOAuthCallback,
  })
}
