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

import {getCurrentConfig} from '../../config/environment.js'
import {BrvConfig} from '../../core/domain/entities/brv-config.js'
import {HttpSpaceService} from '../../infra/space/http-space-service.js'
import {HttpTeamService} from '../../infra/team/http-team-service.js'
import {useAuth} from './auth-context.js'
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
  const {onboardingPreferenceStore, projectConfigStore, trackingService} = useServices()
  const {authToken} = useAuth()

  // Track if user has ever dismissed onboarding (persisted across sessions)
  const [hasDismissed, setHasDismissed] = useState(false)
  const [isLoadingDismissed, setIsLoadingDismissed] = useState(true)

  // Auto-select default team and space
  const autoSelectTeamSpace = useCallback(async () => {
    if (!authToken) return

    try {
      const config = getCurrentConfig()
      const teamService = new HttpTeamService({apiBaseUrl: config.apiBaseUrl})
      const spaceService = new HttpSpaceService({apiBaseUrl: config.apiBaseUrl})

      const {teams} = await teamService.getTeams(authToken.accessToken, authToken.sessionKey, {fetchAll: true})
      const defaultTeam = teams.find((team) => team.isDefault)
      if (!defaultTeam) return

      const {spaces} = await spaceService.getSpaces(authToken.accessToken, authToken.sessionKey, defaultTeam.id, {fetchAll: true})
      const defaultSpace = spaces.find((space) => space.isDefault)
      if (!defaultSpace) return

      const brvConfig = BrvConfig.partialFromSpace({space: defaultSpace})
      await projectConfigStore.write(brvConfig)
    } catch {
      // Silently ignore errors - auto-selection is optional
    }
  }, [authToken, projectConfigStore])

  // Check if user has dismissed onboarding before (based on existence of lastDismissedAt)
  useEffect(() => {
    const initializeOnboarding = async () => {
      try {
        const lastDismissedAt = await onboardingPreferenceStore.getLastDismissedAt()
        const dismissed = Boolean(lastDismissedAt)
        setHasDismissed(dismissed)

        // If showing onboarding and user is logged in, auto-select team/space
        if (!dismissed && authToken?.isValid()) {
          await autoSelectTeamSpace()
        }
      } finally {
        setIsLoadingDismissed(false)
      }
    }

    initializeOnboarding()
  }, [onboardingPreferenceStore, authToken, autoSelectTeamSpace])

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
