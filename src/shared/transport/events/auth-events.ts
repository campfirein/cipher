import type {AuthTokenDTO, BrvConfigDTO, UserDTO} from '../types/dto.js'

export const AuthEvents = {
  EXPIRED: 'auth:expired',
  GET_STATE: 'auth:getState',
  LOGIN_COMPLETED: 'auth:loginCompleted',
  LOGIN_WITH_API_KEY: 'auth:loginWithApiKey',
  LOGOUT: 'auth:logout',
  REFRESH: 'auth:refresh',
  START_LOGIN: 'auth:startLogin',
  STATE_CHANGED: 'auth:stateChanged',
  UPDATED: 'auth:updated',
} as const

export interface AuthGetStateResponse {
  authToken?: AuthTokenDTO
  brvConfig?: BrvConfigDTO
  isAuthorized: boolean
  user?: UserDTO
}

export interface AuthStartLoginResponse {
  authUrl: string
}

export interface AuthLoginCompletedEvent {
  error?: string
  success: boolean
  user?: UserDTO
}

export interface AuthLoginWithApiKeyRequest {
  apiKey: string
}

export interface AuthLoginWithApiKeyResponse {
  error?: string
  success: boolean
  userEmail?: string
}

export interface AuthLogoutResponse {
  success: boolean
}

export interface AuthRefreshResponse {
  success: boolean
}

export interface AuthStateChangedEvent {
  brvConfig?: BrvConfigDTO
  isAuthorized: boolean
  user?: UserDTO
}
