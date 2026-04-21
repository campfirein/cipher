import {useMutation} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  ProviderEvents,
  type ProviderValidateApiKeyRequest,
  type ProviderValidateApiKeyResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'

export type ValidateApiKeyDTO = {
  apiKey: string
  providerId: string
}

export const validateApiKey = ({apiKey, providerId}: ValidateApiKeyDTO): Promise<ProviderValidateApiKeyResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ProviderValidateApiKeyResponse, ProviderValidateApiKeyRequest>(
    ProviderEvents.VALIDATE_API_KEY,
    {apiKey, providerId},
  )
}

type UseValidateApiKeyOptions = {
  mutationConfig?: MutationConfig<typeof validateApiKey>
}

export const useValidateApiKey = ({mutationConfig}: UseValidateApiKeyOptions = {}) =>
  useMutation({
    ...mutationConfig,
    mutationFn: validateApiKey,
  })
