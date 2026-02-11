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
  /** Map of command names to their recommended text (session-only, set after onboarding completes) */
  highlightedCommands: Map<string, string>
  /** Whether the initial async check has completed */
  initialized: boolean
  /** Pending input to restore after page transition (e.g., "/" typed during explore step) */
  pendingInput: string
}

export interface OnboardingActions {
  /**
   * Advance to the next step based on task states.
   * Returns the new step if changed, null otherwise.
   */
  advanceStep: (tasks: Map<string, Task>) => null | OnboardingFlowStep
  /** Clear pending input after it's been consumed */
  clearPendingInput: () => void
  /** Mark onboarding as complete */
  complete: () => void
  /** Remove a command from highlighted commands */
  removeHighlightedCommand: (commandName: string) => void
  /** Reset store to initial state */
  reset: () => void
  /** Set the flow step directly (for transitions not driven by tasks) */
  setFlowStep: (step: OnboardingFlowStep) => void
  /** Set highlighted commands */
  setHighlightedCommands: (commands: Map<string, string>) => void
  /** Mark initialization as complete */
  setInitialized: () => void
  /** Set pending input to restore after page transition */
  setPendingInput: (input: string) => void
}

const initialState: OnboardingState = {
  completedInSession: false,
  flowStep: 'init-provider',
  highlightedCommands: new Map(),
  initialized: false,
  pendingInput: '',
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

  clearPendingInput: () => set({pendingInput: ''}),

  complete: () => set({completedInSession: true}),

  removeHighlightedCommand(commandName) {
    const current = get().highlightedCommands
    const next = new Map(current)
    next.delete(commandName)
    set({highlightedCommands: next})
  },

  reset: () => set(initialState),

  setFlowStep: (step) => set({flowStep: step}),

  setHighlightedCommands: (commands) => set({highlightedCommands: commands}),

  setInitialized: () => set({initialized: true}),

  setPendingInput: (input) => set({pendingInput: input}),
}))
