import {create} from 'zustand'

import type {BrvConfigDTO, UserDTO} from '../../../../shared/transport/types/dto'

export interface AuthState {
  brvConfig: BrvConfigDTO | null
  isAuthorized: boolean
  isLoadingInitial: boolean
  isLoggingIn: boolean
  user: null | UserDTO
}

export interface AuthActions {
  reset: () => void
  setLoggingIn: (isLoggingIn: boolean) => void
  setState: (data: {brvConfig?: BrvConfigDTO | null; isAuthorized: boolean; user?: null | UserDTO}) => void
}

const initialState: AuthState = {
  brvConfig: null,
  isAuthorized: false,
  isLoadingInitial: true,
  isLoggingIn: false,
  user: null,
}

export const useAuthStore = create<AuthActions & AuthState>()((set) => ({
  ...initialState,

  reset: () => set(initialState),

  setLoggingIn: (isLoggingIn: boolean) => set({isLoggingIn}),

  setState: (data) =>
    set((state) => ({
      brvConfig: data.isAuthorized
        ? (data.brvConfig === undefined ? state.brvConfig : data.brvConfig)
        : null,
      isAuthorized: data.isAuthorized,
      isLoggingIn: false,
      user: data.isAuthorized
        ? (data.user === undefined ? state.user : data.user)
        : null,
    })),
}))
