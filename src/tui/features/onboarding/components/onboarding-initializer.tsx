/**
 * Onboarding Initializer
 *
 * Handles async initialization and step transitions.
 * View mode derivation is handled by useAppViewMode selector.
 */

import React, {useEffect, useRef} from 'react'

import {useTransportStore} from '../../../stores/transport-store.js'
import {useTasksStore} from '../../tasks/stores/tasks-store.js'
import {useAppViewMode} from '../hooks/use-app-view-mode.js'
import {useOnboardingStore} from '../stores/onboarding-store.js'
import {getTransitionEvent} from '../utils.js'

interface OnboardingInitializerProps {
  children: React.ReactNode
}

export function OnboardingInitializer({children}: OnboardingInitializerProps): React.ReactNode {
  const trackingService = useTransportStore((s) => s.trackingService)
  const tasks = useTasksStore((s) => s.tasks)

  const {advanceStep, flowStep} = useOnboardingStore()
  const viewMode = useAppViewMode()

  // Track previous step for detecting transitions
  const previousStepRef = useRef(flowStep)

  // Watch tasks and advance step machine (only during onboarding)
  useEffect(() => {
    if (viewMode.type !== 'onboarding') return

    const previousStep = previousStepRef.current
    const newStep = advanceStep(tasks)

    if (newStep) {
      // Track step completion events
      const event = getTransitionEvent(previousStep, newStep)

      if (event) {
        trackingService?.track(`onboarding:${event}`)
      }

      previousStepRef.current = newStep
    }
  }, [advanceStep, tasks, trackingService, viewMode.type])

  // Keep previousStepRef in sync when flowStep changes externally
  useEffect(() => {
    previousStepRef.current = flowStep
  }, [flowStep])

  return <>{children}</>
}
