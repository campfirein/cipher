/**
 * App View Mode Selector
 *
 * Derives the current application view mode from auth and onboarding state.
 * This is the single source of truth for determining what UI to show.
 */

import {useAuthStore} from '../../auth/stores/auth-store.js'
import {useGetActiveProviderConfig} from '../../provider/api/get-active-provider-config.js'
import {useGetStatus} from '../../status/api/get-status.js'

/**
 * Application view modes as a discriminated union.
 */
export type AppViewMode = {type: 'config-provider'} | {type: 'init-project'} | {type: 'loading'} | {type: 'ready'}

/**
 * Selector that derives the current view mode from stored state.
 * This is the ONLY way to determine what UI to show.
 *
 * View mode decision tree:
 * 1. Loading → loading
 * 2. Project not initialized → init-project
 * 3. No provider/model configured → config-provider
 * 4. Otherwise → ready
 */
export function useAppViewMode(): AppViewMode {
  const {isLoadingInitial: isLoadingAuth} = useAuthStore()
  const {data: statusData, isLoading: isLoadingStatus} = useGetStatus()
  const {data: activeData, isLoading: isLoadingActive} = useGetActiveProviderConfig()

  // Still loading auth, status, or active provider check
  if (isLoadingAuth || isLoadingStatus || isLoadingActive) {
    return {type: 'loading'}
  }

  // Project not initialized — .brv/ doesn't exist at cwd
  if (['not_initialized', 'unknown'].includes(statusData?.status.contextTreeStatus || '')) {
    return {type: 'init-project'}
  }

  // ByteRover is the default provider and doesn't require model config
  if (activeData?.activeProviderId === 'byterover') {
    return {type: 'ready'}
  }

  // No active model configured for non-byterover provider — need provider setup
  if (!activeData?.activeModel) {
    return {type: 'config-provider'}
  }

  // Normal app state
  return {type: 'ready'}
}
