/**
 * Onboarding Hook
 *
 * Provides onboarding state and actions with a clean, unified interface.
 */

import {useCallback} from 'react'

import type {OnboardingFlowStep} from '../types.js'

import {useTransportStore} from '../../../stores/transport-store.js'
import {completeOnboarding as completeOnboardingApi} from '../api/complete-onboarding.js'
import {useOnboardingStore} from '../stores/onboarding-store.js'
import {type AppViewMode, useAppViewMode} from './use-app-view-mode.js'

export type {OnboardingFlowStep} from '../types.js'
export type {AppViewMode} from './use-app-view-mode.js'

export interface UseOnboardingReturn {
  /** Complete onboarding (call when user finishes or skips) */
  complete: (options?: {skipped?: boolean}) => void
  /** Complete init (call when init-view finishes) */
  completeInit: () => void
  /** Current application view mode */
  viewMode: AppViewMode
}

/**
 * Hook for consuming onboarding state and actions.
 *
 * @example
 * ```tsx
 * const { viewMode, complete, completeInit } = useOnboarding()
 *
 * if (viewMode.type === 'loading') return <Loading />
 * if (viewMode.type === 'onboarding') return <Onboarding step={viewMode.step} />
 * if (viewMode.type === 'init') return <InitView onComplete={completeInit} />
 * return <App />
 * ```
 */
export function useOnboarding(): UseOnboardingReturn {
  const trackingService = useTransportStore((s) => s.trackingService)
  const viewMode = useAppViewMode()
  const store = useOnboardingStore()

  const complete = useCallback(
    (options?: {skipped?: boolean}) => {
      const step: OnboardingFlowStep | undefined = viewMode.type === 'onboarding' ? viewMode.step : undefined

      store.complete()

      if (options?.skipped && step) {
        trackingService?.track('onboarding:skipped', {step})
      } else {
        trackingService?.track('onboarding:completed')
      }

      completeOnboardingApi({skipped: options?.skipped ?? false}).catch(() => {
        // Silently ignore - non-critical
      })
    },
    [store, trackingService, viewMode],
  )

  return {
    complete,
    completeInit: store.completeInit,
    viewMode,
  }
}
