/**
 * App View Mode Selector
 *
 * Derives the current application view mode from auth state.
 */

import {useAuthStore} from '../../auth/stores/auth-store.js'

/**
 * Application view modes as a discriminated union.
 */
export type AppViewMode = {type: 'loading'} | {type: 'ready'}

/**
 * Parameters for the pure view mode derivation function.
 */
export type DeriveAppViewModeParams = {
  isLoading: boolean
}

/**
 * Pure decision logic for determining the app view mode.
 */
export function deriveAppViewMode(params: DeriveAppViewModeParams): AppViewMode {
  if (params.isLoading) {
    return {type: 'loading'}
  }

  return {type: 'ready'}
}

/**
 * React hook that derives the current view mode from stored state.
 */
export function useAppViewMode(): AppViewMode {
  const {isLoadingInitial: isLoadingAuth} = useAuthStore()

  return deriveAppViewMode({
    isLoading: isLoadingAuth,
  })
}
