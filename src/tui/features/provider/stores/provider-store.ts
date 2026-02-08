/**
 * Provider Store
 *
 * Zustand store for LLM provider state.
 * Pure state + simple setters. Async API calls live in ../api/provider-api.ts.
 */

import {create} from 'zustand'

import type {ProviderDTO} from '../../../../shared/transport/types/dto.js'

export interface ProviderState {
  /** Active provider ID */
  activeProviderId: null | string
  /** Whether providers are loading */
  isLoading: boolean
  /** All available providers */
  providers: ProviderDTO[]
}

export interface ProviderActions {
  /** Reset store to initial state */
  reset: () => void
  /** Set active provider ID */
  setActiveProviderId: (providerId: null | string) => void
  /** Set loading state */
  setLoading: (isLoading: boolean) => void
  /** Set providers list */
  setProviders: (providers: ProviderDTO[]) => void
  /** Update a single provider in the list */
  updateProvider: (providerId: string, update: Partial<ProviderDTO>) => void
}

const initialState: ProviderState = {
  activeProviderId: null,
  isLoading: false,
  providers: [],
}

export const useProviderStore = create<ProviderActions & ProviderState>()((set) => ({
  ...initialState,

  reset: () => set(initialState),

  setActiveProviderId: (providerId) => set({activeProviderId: providerId}),

  setLoading: (isLoading) => set({isLoading}),

  setProviders: (providers) => set({providers}),

  updateProvider: (providerId, update) =>
    set((state) => ({
      providers: state.providers.map((p) => (p.id === providerId ? {...p, ...update} : p)),
    })),
}))
