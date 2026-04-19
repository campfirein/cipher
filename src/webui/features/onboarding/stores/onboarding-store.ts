/**
 * Onboarding store
 *
 * Tracks first-time-user flags (persisted in localStorage) and the live tour
 * state (in-memory only; closing the browser exits the tour). The tour is a
 * lightweight state machine that orchestrates which dialog/sheet is open and
 * what content is prefilled. Steps:
 *
 *   1. provider  — open ProviderFlowDialog, advance when an active provider
 *                  config exists
 *   2. curate    — open TaskComposerSheet prefilled with a curate example.
 *                  After submit, the composer closes and tourTaskId tracks
 *                  the in-flight task; the tour stays on `curate` until the
 *                  user clicks the Continue CTA in the task detail.
 *   3. query     — same flow with a query example
 *   4. connector — show "connect to your AI tool" panel, end tour on Done
 */

import {create} from 'zustand'
import {createJSONStorage, persist} from 'zustand/middleware'

export type TourStep = 'connector' | 'curate' | 'provider' | 'query'

export const TOUR_STEPS: readonly TourStep[] = ['provider', 'curate', 'query', 'connector']

interface OnboardingState {
  // persisted
  seenWelcome: boolean
  // in-memory
  tourActive: boolean

  tourCompleted: boolean
  tourStep: null | TourStep
  /**
   * Set after the user submits a curate/query task in tour mode. While set,
   * the composer stays closed (the tour is "awaiting completion"). Cleared
   * when the user clicks Continue, when the tour exits, or on advance.
   */
  tourTaskId: null | string
}

interface OnboardingActions {
  advanceTour: () => void
  dismissWelcome: () => void
  exitTour: () => void
  goToStep: (step: TourStep) => void
  setTourTaskId: (taskId: null | string) => void
  startTour: (fromStep?: TourStep) => void
}

const initialState: OnboardingState = {
  seenWelcome: false,
  tourActive: false,
  tourCompleted: false,
  tourStep: null,
  tourTaskId: null,
}

export const useOnboardingStore = create<OnboardingActions & OnboardingState>()(
  persist(
    (set, get) => ({
      ...initialState,

      advanceTour() {
        const {tourStep} = get()
        if (!tourStep) return
        const idx = TOUR_STEPS.indexOf(tourStep)
        const next = TOUR_STEPS[idx + 1]
        if (next) {
          set({tourStep: next, tourTaskId: null})
        } else {
          set({tourActive: false, tourCompleted: true, tourStep: null, tourTaskId: null})
        }
      },

      dismissWelcome: () => set({seenWelcome: true}),

      exitTour: () => set({tourActive: false, tourStep: null, tourTaskId: null}),

      goToStep: (step: TourStep) => set({tourActive: true, tourStep: step, tourTaskId: null}),

      setTourTaskId: (tourTaskId: null | string) => set({tourTaskId}),

      startTour: (fromStep: TourStep = 'provider') =>
        set({seenWelcome: true, tourActive: true, tourStep: fromStep, tourTaskId: null}),
    }),
    {
      name: 'brv:onboarding',
      partialize: (state) => ({
        seenWelcome: state.seenWelcome,
        tourCompleted: state.tourCompleted,
      }),
      storage: createJSONStorage(() => globalThis.localStorage),
    },
  ),
)
