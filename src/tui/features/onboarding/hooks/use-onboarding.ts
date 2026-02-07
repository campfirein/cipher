/**
 * Onboarding Hook
 *
 * Provides onboarding state and actions with a clean, unified interface.
 */

import {useCallback, useState} from 'react'

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
  /** Map of command names to their recommended text (session-only, set after onboarding completes) */
  highlightedCommands: Map<string, string>
   /** Remove a command from highlighted commands (called after command is executed) */
  removeHighlightedCommand: (commandName: string) => void
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

  // Highlighted commands with their recommended text (session-only, set after onboarding completes)
  const [highlightedCommands, setHighlightedCommands] = useState<Map<string, string>>(new Map())

  const removeHighlightedCommand = useCallback((commandName: string) => {
    setHighlightedCommands((prev) => {
      const next = new Map(prev)
      next.delete(commandName)
      return next
    })
  }, [])

  const complete = useCallback(
    (options?: {skipped?: boolean}) => {
      const step: OnboardingFlowStep | undefined = viewMode.type === 'onboarding' ? viewMode.step : undefined

      store.complete()

      if (options?.skipped && step) {
        trackingService?.track('onboarding:skipped', {step})
      } else {
        trackingService?.track('onboarding:completed')
        setHighlightedCommands(
          new Map([
            ['connector', 'Recommend: Connect ByteRover to your agents'],
            ['push', 'Recommend: Sync your local context to the cloud'],
            ['status', 'Recommend: Check your context tree status and project info'],
          ]),
        )
      }

      completeOnboardingApi({skipped: options?.skipped ?? false}).catch(() => {
        // Silently ignore - non-critical
      })
    },
    [store, trackingService, viewMode, store.completeInit],
  )

  return {
    complete,
    completeInit: store.completeInit,
    highlightedCommands,
    removeHighlightedCommand,
    viewMode
  }
}
