/**
 * App View Mode Selector
 *
 * Derives the current application view mode from auth and onboarding state.
 * This is the single source of truth for determining what UI to show.
 */

import type {OnboardingFlowStep} from '../types.js'

import {useAuthStore} from '../../auth/stores/auth-store.js'
import {useGetOnboardingState} from '../api/get-onboarding-state.js'
import {useOnboardingStore} from '../stores/onboarding-store.js'

/**
 * The 5 valid application view modes as a discriminated union.
 */
export type AppViewMode =
  | {step: OnboardingFlowStep; type: 'onboarding'}
  | {type: 'init'}
  | {type: 'loading'}
  | {type: 'ready'}

/**
 * Selector that derives the current view mode from stored state.
 * This is the ONLY way to determine what UI to show.
 *
 * View mode decision tree:
 * 1. Loading auth or onboarding check -> 'loading'
 * 2. New user (hasDismissed) -> 'onboarding'
 * 3. Existing user, no provider config -> provider flow
 * 4. Otherwise -> 'ready'
 */
export function useAppViewMode(): AppViewMode {
  const {isLoadingInitial: isLoadingAuth} = useAuthStore()
  const {completedInSession, flowStep} = useOnboardingStore()
  const {data, isLoading: isLoadingOnboardingState} = useGetOnboardingState()
  const hasOnboarded = data?.hasOnboarded ?? false

  // Still loading auth or onboarding initialization
  if (isLoadingAuth || isLoadingOnboardingState) {
    return {type: 'loading'}
  }

  // New user who needs onboarding (hasn't completed CLI onboarding on server)
  const needsOnboarding = !completedInSession && !hasOnboarded
  if (needsOnboarding) {
    return {step: flowStep, type: 'onboarding'}
  }

  // Normal app state
  return {type: 'ready'}
}
