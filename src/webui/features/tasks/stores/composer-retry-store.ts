import {create} from 'zustand'

import type {ComposerType} from '../components/task-composer-types'

/**
 * Hand-off slot between the task-detail "Try again" CTA and the composer
 * host. ErrorSection writes a seed; whichever composer host is active
 * (TaskListView in normal mode, TourHost in tour mode) reads + clears it
 * and re-opens the composer pre-filled with the failed task's content so
 * the user doesn't have to retype.
 */
export interface ComposerRetrySeed {
  content: string
  type: ComposerType
}

interface ComposerRetryState {
  consume: () => ComposerRetrySeed | null
  requestRetry: (seed: ComposerRetrySeed) => void
  seed: ComposerRetrySeed | null
}

export const useComposerRetryStore = create<ComposerRetryState>((set, get) => ({
  consume() {
    const {seed} = get()
    if (seed) set({seed: null})
    return seed
  },

  requestRetry: (seed) => set({seed}),

  seed: null,
}))
