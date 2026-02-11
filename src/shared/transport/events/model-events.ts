import type {ModelDTO} from '../types/dto.js'

export const ModelEvents = {
  LIST: 'model:list',
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

export interface ModelSetActiveRequest {
  modelId: string
  providerId: string
}

export interface ModelSetActiveResponse {
  success: boolean
}
