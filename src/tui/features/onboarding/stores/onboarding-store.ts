/**
 * Onboarding Store
 *
 * Zustand store for onboarding flow state.
 * Uses minimal stored state - view mode is derived via useAppViewMode selector.
 */

import {create} from 'zustand'

import type {Task} from '../../tasks/stores/tasks-store.js'
import type {OnboardingFlowStep} from '../types.js'

import {computeNextStep} from '../utils.js'

export type {OnboardingFlowStep} from '../types.js'

/**
 * Minimal stored state - only what cannot be derived.
 */
export interface OnboardingState {
  /** Whether onboarding was completed/skipped in this session (prevents re-showing) */
  completedInSession: boolean
  /** Current step within onboarding flow */
  flowStep: OnboardingFlowStep
  /** Whether init was completed in this session (prevents re-showing init view) */
  initCompletedInSession: boolean
  /** Whether the initial async check has completed */
  initialized: boolean
}

export interface OnboardingActions {
  /**
   * Advance to the next step based on task states.
   * Returns the new step if changed, null otherwise.
   */
  advanceStep: (tasks: Map<string, Task>) => null | OnboardingFlowStep
  /** Mark onboarding as complete */
  complete: () => void
  /** Mark init as complete */
  completeInit: () => void
  /** Reset store to initial state */
  reset: () => void
  /** Mark initialization as complete */
  setInitialized: () => void
}

const initialState: OnboardingState = {
  completedInSession: false,
  flowStep: 'curate',
  initCompletedInSession: false,
  initialized: false,
}

export const useOnboardingStore = create<OnboardingActions & OnboardingState>()((set, get) => ({
  ...initialState,

  advanceStep(tasks) {
    const current = get().flowStep
    const next = computeNextStep({currentStep: current, tasks})
    if (next !== current) {
      set({flowStep: next})
      return next
    }

    return null
  },

  complete: () =>
    set({
      completedInSession: true,
      initCompletedInSession: true,
    }),

  completeInit: () => set({initCompletedInSession: true}),

  reset: () => set(initialState),

  setInitialized: () => set({initialized: true}),
}))
