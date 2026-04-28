import {create} from 'zustand'

import type {ProviderDTO} from '../../../../shared/transport/types/dto'

export interface ProviderState {
  activeProviderId: null | string
  isDialogOpen: boolean
  isLoading: boolean
  providers: ProviderDTO[]
}

export interface ProviderActions {
  closeProviderDialog: () => void
  openProviderDialog: () => void
  reset: () => void
  setActiveProviderId: (providerId: null | string) => void
  setLoading: (isLoading: boolean) => void
  setProviders: (providers: ProviderDTO[]) => void
  updateProvider: (providerId: string, update: Partial<ProviderDTO>) => void
}

const initialState: ProviderState = {
  activeProviderId: null,
  isDialogOpen: false,
  isLoading: false,
  providers: [],
}

export const useProviderStore = create<ProviderActions & ProviderState>()((set) => ({
  ...initialState,

  closeProviderDialog: () => set({isDialogOpen: false}),

  openProviderDialog: () => set({isDialogOpen: true}),

  reset: () => set(initialState),

  setActiveProviderId: (activeProviderId) => set({activeProviderId}),

  setLoading: (isLoading) => set({isLoading}),

  setProviders: (providers) => set({providers}),

  updateProvider: (providerId, update) =>
    set((state) => ({
      providers: state.providers.map((provider) => (provider.id === providerId ? {...provider, ...update} : provider)),
    })),
}))
