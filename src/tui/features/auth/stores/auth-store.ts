/**
 * Auth Store
 *
 * Zustand store for authentication state.
 * Pure state + simple setters. Async API calls live in ../api/auth-api.ts.
 */

import {create} from 'zustand'

import type {BrvConfigDTO, UserDTO} from '../../../../shared/transport/types/dto.js'

export interface AuthState {
  brvConfig: BrvConfigDTO | null
  isAuthorized: boolean
  isLoadingInitial: boolean
  isLoggingIn: boolean
  user: null | UserDTO
}

export interface AuthActions {
  /** Reset store to initial state */
  reset: () => void
  /** Set logging in state */
  setLoggingIn: (isLoggingIn: boolean) => void
  /** Update auth state (from API response or server event) */
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
