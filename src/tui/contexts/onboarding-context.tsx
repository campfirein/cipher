/**
 * Onboarding Context
 *
 * Global context for managing onboarding state and step derivation.
 * State is derived from brvConfig and sessionExecutions.
 *
 * Usage:
 * ```tsx
 * const {currentStep, shouldShowOnboarding, completeOnboarding} = useOnboarding()
 * ```
 */

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'

import {useAuth} from './auth-context.js'
import {useConsumer} from './index.js'

export type OnboardingStep = 'complete' | 'curate' | 'init' | 'query'

export interface OnboardingContextValue {
  /** Set onboarding complete state */
  completeOnboarding: () => void
  /** Whether user has acknowledged curate completion */
  curateAcknowledged: boolean
  /** Current onboarding step */
  currentStep: OnboardingStep
  /** Whether curate has been completed at least once */
  hasCurated: boolean
  /** Whether query has been completed at least once */
  hasQueried: boolean
  /** Whether the project is initialized (brvConfig exists) */
  isInitialized: boolean
  /** Whether user has acknowledged query completion */
  queryAcknowledged: boolean
  /** Set curate acknowledged state */
  setCurateAcknowledged: (value: boolean) => void
  /** Set query acknowledged state */
  setQueryAcknowledged: (value: boolean) => void
  /** Whether onboarding should be shown */
  shouldShowOnboarding: boolean
  /** Total number of steps (excluding complete) */
  totalSteps: number
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined)

interface OnboardingProviderProps {
  children: React.ReactNode
}

/**
 * Provider for onboarding state
 *
 * State derivation:
 * - Init: When !brvConfig
 * - Curate: When brvConfig exists but no curate completion in session
 * - Query: When curate completed but no query completion in session
 * - Complete: When both curate and query completed
 *
 * Onboarding starts when project is not initialized on mount and
 * continues until all steps are completed and dismissed.
 */
export function OnboardingProvider({children}: OnboardingProviderProps): React.ReactElement {
  const {brvConfig, isInitialConfigLoaded} = useAuth()
  const {sessionExecutions} = useConsumer()

  const isInitialized = brvConfig !== undefined

  // Track if we've already checked initial config state
  const hasCheckedRef = useRef(false)

  // Track if project was not initialized after initial config check
  // This determines whether we're in onboarding mode for this session
  const wasNotInitializedRef = useRef(true)

  // Update ref once initial config load completes (only once)
  // This distinguishes "async load found existing config" from "user just ran init"
  useEffect(() => {
    if (isInitialConfigLoaded && !hasCheckedRef.current) {
      hasCheckedRef.current = true
      if (isInitialized) {
        // Config existed before user interaction - don't show onboarding
        wasNotInitializedRef.current = false
      }
    }
  }, [isInitialConfigLoaded, isInitialized])

  // Track acknowledgment for completed steps (user pressed Enter after seeing output)
  const [curateAcknowledged, setCurateAcknowledged] = useState(false)
  const [queryAcknowledged, setQueryAcknowledged] = useState(false)

  // Track if user has dismissed the onboarding (pressed Enter on complete step)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)

  // Check for completed curate/query executions in session
  const {hasCurated, hasQueried} = useMemo(() => {
    let curateCompleted = false
    let queryCompleted = false

    for (const {execution} of sessionExecutions) {
      if (execution.status === 'completed') {
        if (execution.type === 'curate') {
          curateCompleted = true
        } else if (execution.type === 'query') {
          queryCompleted = true
        }
      }

      // Early exit if both found
      if (curateCompleted && queryCompleted) break
    }

    return {hasCurated: curateCompleted, hasQueried: queryCompleted}
  }, [sessionExecutions])

  // Derive current step (considering acknowledgment)
  // Stay on curate/query step until user acknowledges the completion
  const currentStep: OnboardingStep = useMemo(() => {
    if (!isInitialized) return 'init'
    if (!hasCurated) return 'curate'
    // hasCurated is true but not yet acknowledged -> stay on curate
    if (!curateAcknowledged) return 'curate'
    if (!hasQueried) return 'query'
    // hasQueried is true but not yet acknowledged -> stay on query
    if (!queryAcknowledged) return 'query'
    return 'complete'
  }, [isInitialized, hasCurated, hasQueried, curateAcknowledged, queryAcknowledged])

  // Show onboarding if:
  // 1. Project was not initialized after initial config check, AND
  // 2. User has not dismissed the onboarding
  const shouldShowOnboarding = wasNotInitializedRef.current && !onboardingDismissed

  const completeOnboarding = useCallback(() => {
    setOnboardingDismissed(true)
  }, [])

  const contextValue = useMemo(
    () => ({
      completeOnboarding,
      curateAcknowledged,
      currentStep,
      hasCurated,
      hasQueried,
      isInitialized,
      queryAcknowledged,
      setCurateAcknowledged,
      setQueryAcknowledged,
      shouldShowOnboarding,
      totalSteps: 3, // init, curate, query (complete is not counted)
    }),
    [
      completeOnboarding,
      curateAcknowledged,
      currentStep,
      hasCurated,
      hasQueried,
      isInitialized,
      queryAcknowledged,
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
