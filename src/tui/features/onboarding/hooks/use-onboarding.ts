/**
 * Onboarding Hook
 *
 * Provides onboarding state and actions with a clean, unified interface.
 */

import {useQueryClient} from '@tanstack/react-query'
import {useCallback} from 'react'

import type {OnboardingFlowStep} from '../types.js'

import {useTransportStore} from '../../../stores/transport-store.js'
import {completeOnboarding as completeOnboardingApi} from '../api/complete-onboarding.js'
import {getOnboardingStateQueryOptions} from '../api/get-onboarding-state.js'
import {useOnboardingStore} from '../stores/onboarding-store.js'
import {type AppViewMode, useAppViewMode} from './use-app-view-mode.js'

export type {OnboardingFlowStep} from '../types.js'
export type {AppViewMode} from './use-app-view-mode.js'

export interface UseOnboardingReturn {
  /** Clear pending input after it's been consumed */
  clearPendingInput: () => void
  /** Complete onboarding (call when user finishes or skips) */
  complete: (options?: {skipped?: boolean}) => void
  /** Map of command names to their recommended text (session-only, set after onboarding completes) */
  highlightedCommands: Map<string, string>
  /** Pending input to restore after page transition */
  pendingInput: string
  /** Remove a command from highlighted commands (called after command is executed) */
  removeHighlightedCommand: (commandName: string) => void
  /** Set the flow step directly (for transitions not driven by tasks) */
  setFlowStep: (step: OnboardingFlowStep) => void
  /** Set pending input to restore after page transition */
  setPendingInput: (input: string) => void
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
  const queryClient = useQueryClient()
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
        store.setHighlightedCommands(
          new Map([
            ['connectors', 'Recommend: Connect ByteRover to your agents'],
            ['push', 'Recommend: Sync your local context to the cloud'],
            ['status', 'Recommend: Check your context tree status and project info'],
          ]),
        )
      }

      completeOnboardingApi({skipped: options?.skipped ?? false})
        .finally(() => {
          queryClient.invalidateQueries({queryKey: getOnboardingStateQueryOptions().queryKey})
        })
    },
    [store, trackingService, viewMode],
  )

  return {
    clearPendingInput: store.clearPendingInput,
    complete,
    highlightedCommands: store.highlightedCommands,
    pendingInput: store.pendingInput,
    removeHighlightedCommand: store.removeHighlightedCommand,
    setFlowStep: store.setFlowStep,
    setPendingInput: store.setPendingInput,
    viewMode,
  }
}
