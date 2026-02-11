import {useMutation, useQueryClient} from '@tanstack/react-query'

import type {MutationConfig} from '../../../lib/react-query.js'

import {
  type OnboardingCompleteRequest,
  type OnboardingCompleteResponse,
  OnboardingEvents,
} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'
import {getOnboardingStateQueryOptions} from './get-onboarding-state.js'

export type CompleteOnboardingDTO = {
  skipped?: boolean
}

export const completeOnboarding = ({skipped}: CompleteOnboardingDTO): Promise<OnboardingCompleteResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<OnboardingCompleteResponse, OnboardingCompleteRequest>(OnboardingEvents.COMPLETE, {skipped})
}

type UseCompleteOnboardingOptions = {
  mutationConfig?: MutationConfig<typeof completeOnboarding>
}

export const useCompleteOnboarding = ({mutationConfig}: UseCompleteOnboardingOptions = {}) => {
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
    mutationFn: completeOnboarding,
  })
}
