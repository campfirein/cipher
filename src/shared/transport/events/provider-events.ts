import type {ProviderDTO} from '../types/dto.js'

export const ProviderEvents = {
  CONNECT: 'provider:connect',
  DISCONNECT: 'provider:disconnect',
  GET_ACTIVE: 'provider:getActive',
  LIST: 'provider:list',
  SET_ACTIVE: 'provider:setActive',
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
}

export interface ProviderSetActiveRequest {
  providerId: string
}

export interface ProviderSetActiveResponse {
  success: boolean
}
