/**
 * Onboarding Context
 *
 * Global context for managing onboarding state and step derivation.
 * State is derived from brvConfig and tasks from transport events.
 *
 * Usage:
 * ```tsx
 * const {currentStep, shouldShowOnboarding, completeOnboarding} = useOnboarding()
 * ```
 */

import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react'

import {useServices} from './services-context.js'
import {useTasks} from './tasks-context.js'

export type OnboardingStep = 'curate' | 'curating' | 'explore' | 'query' | 'querying'

export interface OnboardingContextValue {
  /** Set onboarding complete state. Pass skipped=true when user skips via Esc */
  completeOnboarding: (skipped?: boolean) => void
  /** Current onboarding step */
  currentStep: OnboardingStep
  /** Whether we're still loading the dismissed state */
  isLoadingDismissed: boolean
  /** Set current onboarding step */
  setCurrentStep: (step: OnboardingStep) => void
  /** Whether onboarding should be shown */
  shouldShowOnboarding: boolean
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined)

interface OnboardingProviderProps {
  children: React.ReactNode
}

/**
 * Provider for onboarding state
 *
 * Step flow: curate → curating → query → querying → explore
 * Transitions happen automatically based on task states.
 *
 * Onboarding starts when user has not dismissed.
 */
export function OnboardingProvider({children}: OnboardingProviderProps): React.ReactElement {
  const {tasks} = useTasks()
  const {onboardingPreferenceStore, trackingService} = useServices()

  // Track if user has ever dismissed onboarding (persisted across sessions)
  const [hasDismissed, setHasDismissed] = useState(false)
  const [isLoadingDismissed, setIsLoadingDismissed] = useState(true)

  // Check if user has dismissed onboarding before (based on existence of lastDismissedAt)
  useEffect(() => {
    const checkDismissed = async () => {
      try {
        const lastDismissedAt = await onboardingPreferenceStore.getLastDismissedAt()
        setHasDismissed(Boolean(lastDismissedAt))
      } finally {
        setIsLoadingDismissed(false)
      }
    }

    checkDismissed()
  }, [onboardingPreferenceStore])

  // Current onboarding step state
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('curate')

  // Watch tasks and automatically transition steps
  // Flow: curate → curating → query → querying → explore
  useEffect(() => {
    let isCurating = false
    let hasCurated = false
    let isQuerying = false
    let hasQueried = false

    for (const task of tasks.values()) {
      if (task.type === 'curate') {
        if (task.status === 'completed') hasCurated = true
        if (task.status === 'started' || task.status === 'created') isCurating = true
      }

      if (task.type === 'query') {
        if (task.status === 'completed') hasQueried = true
        if (task.status === 'started' || task.status === 'created') isQuerying = true
      }
    }

    if (currentStep === 'explore') return

    if (currentStep === 'querying' && hasQueried) {
      trackingService.track('onboarding:query_completed')
      setCurrentStep('explore')
      return
    }

    if (currentStep === 'query' && isQuerying) {
      setCurrentStep('querying')
      return
    }

    if (currentStep === 'curating' && hasCurated) {
      trackingService.track('onboarding:curate_completed')
      setCurrentStep('query')
      return
    }

    if (currentStep === 'curate' && isCurating) {
      setCurrentStep('curating')
    }
  }, [tasks, currentStep, trackingService])

  // Show onboarding if user has never dismissed onboarding before (persisted)
  const shouldShowOnboarding = !hasDismissed

  const completeOnboarding = useCallback(
    (skipped = false) => {
      setHasDismissed(true)
      onboardingPreferenceStore.setLastDismissedAt(Date.now())
      if (skipped) {
        trackingService.track('onboarding:skipped', {step: currentStep})
      } else {
        trackingService.track('onboarding:completed')
      }
    },
    [currentStep, onboardingPreferenceStore, trackingService],
  )

  const contextValue = useMemo(
    () => ({
      completeOnboarding,
      currentStep,
      isLoadingDismissed,
      setCurrentStep,
      shouldShowOnboarding,
    }),
    [
      completeOnboarding,
      currentStep,
      hasDismissed,
      isLoadingDismissed,
      shouldShowOnboarding,
    ],
  )

  return <OnboardingContext.Provider value={contextValue}>{children}</OnboardingContext.Provider>
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext)
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider')
  }

  return context
}
