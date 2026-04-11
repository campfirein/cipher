import type {BrvConfigDTO} from '../types/dto.js'

export const ConfigEvents = {
  GET_ENVIRONMENT: 'config:getEnvironment',
  GET_PROJECT: 'config:getProject',
  PROJECT_CHANGED: 'config:projectChanged',
} as const

export interface ConfigGetEnvironmentResponse {
  iamBaseUrl: string
  isDevelopment: boolean
  webAppUrl: string
}

export interface ConfigGetProjectResponse {
  config?: BrvConfigDTO
  exists: boolean
}

export interface ConfigProjectChangedEvent {
  config: BrvConfigDTO
}
