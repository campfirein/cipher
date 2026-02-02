/**
 * Model Store
 *
 * Zustand store for LLM model selection state.
 * Pure state + simple setters. Async API calls live in ../api/model-api.ts.
 */

import {create} from 'zustand'

import type {ModelDTO} from '../../../../shared/transport/types/dto.js'

export interface ModelState {
  /** Currently active model ID */
  activeModel: null | string
  /** Favorite model IDs */
  favorites: string[]
  /** Whether models are loading */
  isLoading: boolean
  /** Available models for the active provider */
  models: ModelDTO[]
  /** Recently used model IDs */
  recent: string[]
}

export interface ModelActions {
  /** Set active model ID */
  setActiveModel: (modelId: null | string) => void
  /** Set loading state */
  setLoading: (isLoading: boolean) => void
  /** Set models list with metadata */
  setModels: (data: {activeModel?: string; favorites: string[]; models: ModelDTO[]; recent: string[]}) => void
}

export const useModelStore = create<ModelActions & ModelState>()((set) => ({
  activeModel: null,
  favorites: [],
  isLoading: false,
  models: [],
  recent: [],

  setActiveModel: (modelId) => set({activeModel: modelId}),

  setLoading: (isLoading) => set({isLoading}),

  setModels: (data) =>
    set({
      activeModel: data.activeModel ?? null,
      favorites: data.favorites,
      models: data.models,
      recent: data.recent,
    }),
}))
