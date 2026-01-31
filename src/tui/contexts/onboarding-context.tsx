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

import {getCurrentConfig} from '../../server/config/environment.js'
import {BrvConfig} from '../../server/core/domain/entities/brv-config.js'
import {HttpSpaceService} from '../../server/infra/space/http-space-service.js'
import {HttpTeamService} from '../../server/infra/team/http-team-service.js'
import {HttpUserService} from '../../server/infra/user/http-user-service.js'
import {useAuth} from './auth-context.js'
import {useTransport} from './index.js'
import {useServices} from './services-context.js'
import {useTasks} from './tasks-context.js'

export type OnboardingStep = 'curate' | 'curating' | 'explore' | 'query' | 'querying'

export interface OnboardingContextValue {
  /** Mark init flow as complete */
  completeInitFlow: () => void
  /** Set onboarding complete state. Pass skipped=true when user skips via Esc */
  completeOnboarding: (skipped?: boolean) => void
  /** Current onboarding step */
  currentStep: OnboardingStep
  /** Whether init flow has been completed */
  initFlowCompleted: boolean
  /** Whether onboarding check is still loading (user check + auto-select if needed) */
  isLoadingOnboardingCheck: boolean
  /** Set current onboarding step */
  setCurrentStep: (step: OnboardingStep) => void
  /** Whether init view should be shown */
  shouldShowInit: boolean
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
 * Onboarding starts when user.hasOnboardedCli is false.
 */
export function OnboardingProvider({children}: OnboardingProviderProps): React.ReactElement {
  const {tasks} = useTasks()
  const {projectConfigStore, trackingService} = useServices()
  const {authToken, brvConfig, isLoadingUser, user} = useAuth()
  const {client} = useTransport()

  // Track if onboarding was completed in this session (to hide immediately after completing)
  const [completedInSession, setCompletedInSession] = useState(false)

  // Track if init flow has been completed
  const [initFlowCompleted, setInitFlowCompleted] = useState(Boolean(brvConfig))
  const completeInitFlow = useCallback(() => setInitFlowCompleted(true), [])

  // Track if onboarding check is loading (user check + auto-select if needed)
  const [isLoadingOnboardingCheck, setIsLoadingOnboardingCheck] = useState(true)

  // Auto-select default team and space
  const autoSelectTeamSpace = useCallback(async () => {
    if (!authToken) return

    try {
      const config = getCurrentConfig()
      const teamService = new HttpTeamService({apiBaseUrl: config.apiBaseUrl})
      const spaceService = new HttpSpaceService({apiBaseUrl: config.apiBaseUrl})

      const {teams} = await teamService.getTeams(authToken.sessionKey, {fetchAll: true})
      const defaultTeam = teams.find((team) => team.isDefault)
      if (!defaultTeam) return

      const {spaces} = await spaceService.getSpaces(authToken.sessionKey, defaultTeam.id, {fetchAll: true})
      const defaultSpace = spaces.find((space) => space.isDefault)
      if (!defaultSpace) return

      const brvConfig = BrvConfig.partialFromSpace({space: defaultSpace})
      await projectConfigStore.write(brvConfig)
      await client?.requestWithAck('agent:restart', {reason: 'Auto select team/space'})
    } catch {
      // Silently ignore errors - auto-selection is optional
    }
  }, [authToken, client, projectConfigStore])

  // Auto-select team/space when showing onboarding and user is logged in
  useEffect(() => {
    const checkOnboarding = async () => {
      if (isLoadingUser) return

      // User has already onboarded - no need to auto-select
      if (user?.hasOnboardedCli) {
        setIsLoadingOnboardingCheck(false)
        return
      }

      // User needs onboarding - run auto-select then set loading to false
      if (user && !user.hasOnboardedCli && authToken?.isValid()) {
        await autoSelectTeamSpace()
      }

      setIsLoadingOnboardingCheck(false)
    }

    checkOnboarding()
  }, [isLoadingUser, user, authToken, autoSelectTeamSpace])

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

  // Show onboarding if user has not completed onboarding (from server) and not completed in this session
  const shouldShowOnboarding = !completedInSession && user !== undefined && !user.hasOnboardedCli && !isLoadingUser

  // Show init view if init flow not completed and not showing onboarding
  const shouldShowInit = !initFlowCompleted && !shouldShowOnboarding && !isLoadingUser

  const completeOnboarding = useCallback(
    (skipped = false) => {
      setCompletedInSession(true)
      completeInitFlow()
      if (skipped) {
        trackingService.track('onboarding:skipped', {step: currentStep})
      } else {
        trackingService.track('onboarding:completed')
      }

      // Update user's hasOnboardedCli flag on the server
      if (authToken?.isValid()) {
        const config = getCurrentConfig()
        const userService = new HttpUserService({apiBaseUrl: config.apiBaseUrl})
        userService.updateCurrentUser(authToken.sessionKey, {hasOnboardedCli: true})
      }
    },
    [authToken, currentStep, trackingService],
  )

  const contextValue = useMemo(
    () => ({
      completeInitFlow,
      completeOnboarding,
      currentStep,
      initFlowCompleted,
      isLoadingOnboardingCheck,
      setCurrentStep,
      shouldShowInit,
      shouldShowOnboarding,
    }),
    [
      completeInitFlow,
      completeOnboarding,
      currentStep,
      initFlowCompleted,
      isLoadingOnboardingCheck,
      shouldShowInit,
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
