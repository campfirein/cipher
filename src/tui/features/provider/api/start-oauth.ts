import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {
  ProviderEvents,
  type ProviderStartOAuthRequest,
  type ProviderStartOAuthResponse,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export type StartOAuthDTO = {
  providerId: string
}

export const startOAuth = ({providerId}: StartOAuthDTO): Promise<ProviderStartOAuthResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ProviderStartOAuthResponse, ProviderStartOAuthRequest>(ProviderEvents.START_OAUTH, {
    providerId,
  })
}

type UseStartOAuthOptions = {
  mutationConfig?: MutationConfig<typeof startOAuth>
}

export const useStartOAuth = ({mutationConfig}: UseStartOAuthOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: startOAuth,
  })
