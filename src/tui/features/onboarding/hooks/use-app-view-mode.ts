/**
 * App View Mode Selector
 *
 * Derives the current application view mode from auth and onboarding state.
 * This is the single source of truth for determining what UI to show.
 */

import {useAuthStore} from '../../auth/stores/auth-store.js'
import {useGetActiveProviderConfig} from '../../provider/api/get-active-provider-config.js'

/**
 * The valid application view modes as a discriminated union.
 */
export type AppViewMode =
  | {type: 'config-provider'}
  | {type: 'loading'}
  | {type: 'ready'}

/**
 * Parameters for the pure view mode derivation function.
 */
export type DeriveAppViewModeParams = {
  activeModel?: string
  activeProviderId?: string
  isAuthorized: boolean
  isLoading: boolean
}

/**
 * Pure decision logic for determining the app view mode.
 * Extracted from useAppViewMode for testability.
 *
 * Decision tree:
 * 1. Loading → 'loading'
 * 2. ByteRover + unauthenticated → 'config-provider'
 * 3. ByteRover + authenticated → 'ready'
 * 4. Non-byterover + no active model → 'config-provider'
 * 5. Otherwise → 'ready'
 */
export function deriveAppViewMode(params: DeriveAppViewModeParams): AppViewMode {
  if (params.isLoading) {
    return {type: 'loading'}
  }

  if (params.activeProviderId === 'byterover' && !params.isAuthorized) {
    return {type: 'config-provider'}
  }

  if (params.activeProviderId === 'byterover') {
    return {type: 'ready'}
  }

  if (!params.activeModel) {
    return {type: 'config-provider'}
  }

  return {type: 'ready'}
}

/**
 * React hook that derives the current view mode from stored state.
 * Thin wrapper around deriveAppViewMode — reads from stores, delegates logic.
 */
export function useAppViewMode(): AppViewMode {
  const {isAuthorized, isLoadingInitial: isLoadingAuth} = useAuthStore()
  const {data: activeData, isLoading: isLoadingActive} = useGetActiveProviderConfig()

  return deriveAppViewMode({
    activeModel: activeData?.activeModel,
    activeProviderId: activeData?.activeProviderId,
    isAuthorized,
    isLoading: isLoadingAuth || isLoadingActive,
  })
}
