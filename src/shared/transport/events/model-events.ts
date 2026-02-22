import type {ModelDTO} from '../types/dto.js'

export const ModelEvents = {
  LIST: 'model:list',
  LIST_BY_PROVIDERS: 'model:listByProviders',
  SET_ACTIVE: 'model:setActive',
} as const

export interface ModelListRequest {
  providerId: string
}

export interface ModelListResponse {
  activeModel?: string
  favorites: string[]
  models: ModelDTO[]
  recent: string[]
}

export interface ModelListByProvidersRequest {
  providerIds: string[]
}

export interface ModelListByProvidersResponse {
  models: ModelDTO[]
}

export interface ModelSetActiveRequest {
  modelId: string
  providerId: string
}

export interface ModelSetActiveResponse {
  success: boolean
}
