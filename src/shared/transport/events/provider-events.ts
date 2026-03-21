import type {ProviderDTO} from '../types/dto.js'

export const ProviderEvents = {
  AWAIT_OAUTH_CALLBACK: 'provider:awaitOAuthCallback',
  CANCEL_OAUTH: 'provider:cancelOAuth',
  CONNECT: 'provider:connect',
  DISCONNECT: 'provider:disconnect',
  GET_ACTIVE: 'provider:getActive',
  LIST: 'provider:list',
  SET_ACTIVE: 'provider:setActive',
  START_OAUTH: 'provider:startOAuth',
  SUBMIT_OAUTH_CODE: 'provider:submitOAuthCode',
  UPDATED: 'provider:updated',
  VALIDATE_API_KEY: 'provider:validateApiKey',
} as const

export interface ProviderListResponse {
  providers: ProviderDTO[]
}

export interface ProviderConnectRequest {
  apiKey?: string
  baseUrl?: string
  providerId: string
}

export interface ProviderConnectResponse {
  error?: string
  success: boolean
}

export interface ProviderDisconnectRequest {
  providerId: string
}

export interface ProviderDisconnectResponse {
  success: boolean
}

export interface ProviderValidateApiKeyRequest {
  apiKey: string
  providerId: string
}

export interface ProviderValidateApiKeyResponse {
  error?: string
  isValid: boolean
}

export interface ProviderGetActiveResponse {
  activeModel?: string
  activeProviderId: string
  /** True when the active provider requires authentication but the user is not logged in. */
  authRequired?: boolean
}

export interface ProviderSetActiveRequest {
  providerId: string
}

export interface ProviderSetActiveResponse {
  error?: string
  success: boolean
}

// ==================== OAuth Events ====================

export interface ProviderCancelOAuthRequest {
  providerId: string
}

export interface ProviderCancelOAuthResponse {
  success: boolean
}

export interface ProviderStartOAuthRequest {
  mode?: string
  providerId: string
}

export interface ProviderStartOAuthResponse {
  authUrl: string
  callbackMode: 'auto' | 'code-paste'
  error?: string
  success: boolean
}

export interface ProviderAwaitOAuthCallbackRequest {
  providerId: string
}

export interface ProviderAwaitOAuthCallbackResponse {
  error?: string
  success: boolean
}

export interface ProviderSubmitOAuthCodeRequest {
  code: string
  providerId: string
}

export interface ProviderSubmitOAuthCodeResponse {
  error?: string
  success: boolean
}
