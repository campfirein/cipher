/**
 * App View Mode Selector
 *
 * Derives the current application view mode from auth and onboarding state.
 * This is the single source of truth for determining what UI to show.
 */

import {useAuthStore} from '../../auth/stores/auth-store.js'
import {useHasActiveModel} from '../../provider/api/has-active-model.js'

/**
 * The 5 valid application view modes as a discriminated union.
 */
export type AppViewMode =
  | {type: 'config-provider'}
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
  const {data: activeModelData, isLoading: isLoadingActiveModel} = useHasActiveModel()

  // Still loading auth, onboarding, or active model check
  if (isLoadingAuth || isLoadingActiveModel) {
    return {type: 'loading'}
  }

  // No active model configured — need provider setup
  if (!activeModelData?.hasActiveModel) {
    return {type: 'config-provider'}
  }

  // Normal app state
  return {type: 'ready'}
}
