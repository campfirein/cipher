import type {AuthTokenDTO, BrvConfigDTO, UserDTO} from '../types/dto.js'

export const AuthEvents = {
  GET_STATE: 'auth:getState',
  LOGIN_COMPLETED: 'auth:loginCompleted',
  LOGOUT: 'auth:logout',
  REFRESH: 'auth:refresh',
  START_LOGIN: 'auth:startLogin',
  STATE_CHANGED: 'auth:stateChanged',
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
