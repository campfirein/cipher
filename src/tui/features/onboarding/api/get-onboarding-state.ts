import {queryOptions, useQuery} from '@tanstack/react-query'

import type {QueryConfig} from '../../../lib/react-query.js'

import {OnboardingEvents, type OnboardingGetStateResponse} from '../../../../shared/transport/events/index.js'
import {useTransportStore} from '../../../stores/transport-store.js'

export const getOnboardingState = (): Promise<OnboardingGetStateResponse> => {
  const {apiClient} = useTransportStore.getState()
  if (!apiClient) return Promise.reject(new Error('Not connected'))

  return apiClient.request<OnboardingGetStateResponse>(OnboardingEvents.GET_STATE)
}

export const getOnboardingStateQueryOptions = () =>
  queryOptions({
    queryFn: getOnboardingState,
    queryKey: ['onboarding', 'state'],
  })

type UseGetOnboardingStateOptions = {
  queryConfig?: QueryConfig<typeof getOnboardingStateQueryOptions>
}

export const useGetOnboardingState = ({queryConfig}: UseGetOnboardingStateOptions = {}) =>
  useQuery({
    ...getOnboardingStateQueryOptions(),
    ...queryConfig,
  })
