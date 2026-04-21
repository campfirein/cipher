import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query'

import {
  ProviderEvents,
  type ProviderSubmitOAuthCodeRequest,
  type ProviderSubmitOAuthCodeResponse,
} from '../../../../shared/transport/events'
import {useTransportStore} from '../../../stores/transport-store'
import {getProvidersQueryOptions} from './get-providers'

export type SubmitOAuthCodeDTO = {
  code: string
  providerId: string
}

export const submitOAuthCode = ({code, providerId}: SubmitOAuthCodeDTO): Promise<ProviderSubmitOAuthCodeResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<ProviderSubmitOAuthCodeResponse, ProviderSubmitOAuthCodeRequest>(
    ProviderEvents.SUBMIT_OAUTH_CODE,
    {code, providerId},
  )
}

type UseSubmitOAuthCodeOptions = {
  mutationConfig?: MutationConfig<typeof submitOAuthCode>
}

export const useSubmitOAuthCode = ({mutationConfig}: UseSubmitOAuthCodeOptions = {}) => {
  const queryClient = useQueryClient()
  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({queryKey: getProvidersQueryOptions().queryKey})
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: submitOAuthCode,
  })
}
