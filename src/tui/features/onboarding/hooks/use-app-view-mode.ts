/**
 * App View Mode Selector
 *
 * Derives the current application view mode from auth and onboarding state.
 * This is the single source of truth for determining what UI to show.
 */

import type {OnboardingFlowStep} from '../types.js'

import {useAuthStore} from '../../auth/stores/auth-store.js'
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
 * 2. New user (hasOnboardedCli=false) -> 'onboarding'
 * 3. Existing user, no brvConfig -> 'init'
 * 4. Otherwise -> 'ready'
 */
export function useAppViewMode(): AppViewMode {
  const {brvConfig, isLoadingInitial: isLoadingAuth, user} = useAuthStore()
  const {completedInSession, flowStep, initCompletedInSession, initialized} = useOnboardingStore()

  // Still loading auth or onboarding initialization
  if (isLoadingAuth || !initialized) {
    return {type: 'loading'}
  }

  // User is not logged in - handled by auth guard elsewhere, but provide safe fallback
  if (!user) {
    return {type: 'loading'}
  }

  // New user who needs onboarding (hasn't completed CLI onboarding on server)
  const needsOnboarding = !user.hasOnboardedCli && !completedInSession
  if (needsOnboarding) {
    return {step: flowStep, type: 'onboarding'}
  }

  // Existing user but project needs initialization (no .brv/config.json)
  const projectNeedsInit = !brvConfig && !initCompletedInSession
  if (projectNeedsInit) {
    return {type: 'init'}
  }

  // Normal app state
  return {type: 'ready'}
}
