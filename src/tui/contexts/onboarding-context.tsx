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

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'

import {useAuth} from './auth-context.js'
import {useServices} from './services-context.js'
import {useTasks} from './tasks-context.js'

export type OnboardingStep = 'complete' | 'curate' | 'init' | 'query'

export interface OnboardingContextValue {
  /** Set onboarding complete state. Pass skipped=true when user skips via Esc */
  completeOnboarding: (skipped?: boolean) => void
  /** Whether user has acknowledged curate completion */
  curateAcknowledged: boolean
  /** Current onboarding step */
  currentStep: OnboardingStep
  /** Whether curate has been completed at least once */
  hasCurated: boolean
  /** Whether query has been completed at least once */
  hasQueried: boolean
  /** Whether user has acknowledged init completion */
  initAcknowledged: boolean
  /** Whether the project is initialized (brvConfig exists) */
  isInitialized: boolean
  /** Whether we're still loading the dismissed state */
  isLoadingDismissed: boolean
  /** Whether user has acknowledged query completion */
  queryAcknowledged: boolean
  /** Set curate acknowledged state */
  setCurateAcknowledged: (value: boolean) => void
  /** Set init acknowledged state */
  setInitAcknowledged: (value: boolean) => void
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
  const {tasks} = useTasks()
  const {onboardingPreferenceStore, trackingService} = useServices()

  const isInitialized = brvConfig !== undefined

  // Track if we've already checked initial config state
  const hasCheckedRef = useRef(false)

  // Track if project was not initialized after initial config check
  // This determines whether we're in onboarding mode for this session
  const wasNotInitializedRef = useRef(true)

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
  const [initAcknowledged, setInitAcknowledgedState] = useState(false)
  const [curateAcknowledged, setCurateAcknowledgedState] = useState(false)
  const [queryAcknowledged, setQueryAcknowledgedState] = useState(false)

  // Track if init was completed during this onboarding session (to avoid duplicate tracking)
  const initTrackedRef = useRef(false)

  // Track init completion when isInitialized changes during onboarding
  useEffect(() => {
    if (wasNotInitializedRef.current && isInitialized && !initTrackedRef.current) {
      initTrackedRef.current = true
      trackingService.track('onboarding:init_completed')
    }
  }, [isInitialized, trackingService])

  // Wrapper for setInitAcknowledged that also tracks
  const setInitAcknowledged = useCallback(
    (value: boolean) => {
      setInitAcknowledgedState(value)
    },
    [],
  )

  // Wrapper for setCurateAcknowledged that also tracks
  const setCurateAcknowledged = useCallback(
    (value: boolean) => {
      setCurateAcknowledgedState(value)
      if (value) {
        trackingService.track('onboarding:curate_completed')
      }
    },
    [trackingService],
  )

  // Wrapper for setQueryAcknowledged that also tracks
  const setQueryAcknowledged = useCallback(
    (value: boolean) => {
      setQueryAcknowledgedState(value)
      if (value) {
        trackingService.track('onboarding:query_completed')
      }
    },
    [trackingService],
  )

  // Check for completed curate/query tasks in session
  const {hasCurated, hasQueried} = useMemo(() => {
    let curateCompleted = false
    let queryCompleted = false

    for (const task of tasks.values()) {
      if (task.status === 'completed') {
        if (task.type === 'curate') {
          curateCompleted = true
        } else if (task.type === 'query') {
          queryCompleted = true
        }
      }

      // Early exit if both found
      if (curateCompleted && queryCompleted) break
    }

    return {hasCurated: curateCompleted, hasQueried: queryCompleted}
  }, [tasks])

  // Derive current step (considering acknowledgment)
  // Stay on each step until user acknowledges the completion
  const currentStep: OnboardingStep = useMemo(() => {
    if (!isInitialized) return 'init'
    // isInitialized is true but not yet acknowledged -> stay on init
    if (!initAcknowledged) return 'init'
    if (!hasCurated) return 'curate'
    // hasCurated is true but not yet acknowledged -> stay on curate
    if (!curateAcknowledged) return 'curate'
    if (!hasQueried) return 'query'
    // hasQueried is true but not yet acknowledged -> stay on query
    if (!queryAcknowledged) return 'query'
    return 'complete'
  }, [isInitialized, initAcknowledged, hasCurated, hasQueried, curateAcknowledged, queryAcknowledged])

  // Show onboarding if:
  // 1. Project was not initialized after initial config check, AND
  // 2. User has never dismissed onboarding before (persisted)
  const shouldShowOnboarding = wasNotInitializedRef.current && !hasDismissed

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
      curateAcknowledged,
      currentStep,
      hasCurated,
      hasQueried,
      initAcknowledged,
      isInitialized,
      isLoadingDismissed,
      queryAcknowledged,
      setCurateAcknowledged,
      setInitAcknowledged,
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
      hasDismissed,
      initAcknowledged,
      isInitialized,
      isLoadingDismissed,
      queryAcknowledged,
      setInitAcknowledged,
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
