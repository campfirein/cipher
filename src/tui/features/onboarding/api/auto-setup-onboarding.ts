import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {type OnboardingAutoSetupResponse, OnboardingEvents} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getOnboardingStateQueryOptions} from './get-onboarding-state.js'

export const autoSetupOnboarding = (): Promise<OnboardingAutoSetupResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<OnboardingAutoSetupResponse>(OnboardingEvents.AUTO_SETUP)
}

type UseAutoSetupOnboardingOptions = {
  mutationConfig?: MutationConfig<typeof autoSetupOnboarding>
}

export const useAutoSetupOnboarding = ({mutationConfig}: UseAutoSetupOnboardingOptions = {}) => {
  const queryClient = useQueryClient()

  const {onSuccess, ...restConfig} = mutationConfig ?? {}

  return useMutation({
    onSuccess(...args) {
      queryClient.invalidateQueries({
        queryKey: getOnboardingStateQueryOptions().queryKey,
      })
      onSuccess?.(...args)
    },
    ...restConfig,
    mutationFn: autoSetupOnboarding,
  })
}
