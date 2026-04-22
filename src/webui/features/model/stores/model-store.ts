import {create} from 'zustand'

import type {ModelDTO} from '../../../../shared/transport/types/dto'

export interface ModelState {
  activeModel: null | string
  favorites: string[]
  isLoading: boolean
  models: ModelDTO[]
  recent: string[]
}

export interface ModelActions {
  reset: () => void
  setActiveModel: (modelId: null | string) => void
  setLoading: (isLoading: boolean) => void
  setModels: (data: {activeModel?: string; favorites: string[]; models: ModelDTO[]; recent: string[]}) => void
}

const initialState: ModelState = {
  activeModel: null,
  favorites: [],
  isLoading: false,
  models: [],
  recent: [],
}

export const useModelStore = create<ModelActions & ModelState>()((set) => ({
  ...initialState,

  reset: () => set(initialState),

  setActiveModel: (activeModel) => set({activeModel}),

  setLoading: (isLoading) => set({isLoading}),

  setModels: (data) =>
    set({
      activeModel: data.activeModel ?? null,
      favorites: data.favorites,
      models: data.models,
      recent: data.recent,
    }),
}))
