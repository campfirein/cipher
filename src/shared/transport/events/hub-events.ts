import type {AuthScheme} from '../types/auth-scheme.js'
import type {HubEntryDTO} from '../types/dto.js'

export const HubEvents = {
  INSTALL: 'hub:install',
  LIST: 'hub:list',
  LIST_PROGRESS: 'hub:list:progress',
  REGISTRY_ADD: 'hub:registry:add',
  REGISTRY_ADD_PROGRESS: 'hub:registry:add:progress',
  REGISTRY_LIST: 'hub:registry:list',
  REGISTRY_LIST_PROGRESS: 'hub:registry:list:progress',
  REGISTRY_REMOVE: 'hub:registry:remove',
} as const

export interface HubProgressEvent {
  message: string
  step: string
}

export interface HubListResponse {
  entries: HubEntryDTO[]
  version: string
}

export interface HubInstallRequest {
  agent?: string
  entryId: string
  registry?: string
}

export interface HubInstallResponse {
  installedFiles: string[]
  message: string
  success: boolean
}

// Registry management

export interface HubRegistryAddRequest {
  authScheme?: AuthScheme
  headerName?: string
  name: string
  token?: string
  url: string
}

export interface HubRegistryAddResponse {
  message: string
  success: boolean
}

export interface HubRegistryRemoveRequest {
  name: string
}

export interface HubRegistryRemoveResponse {
  message: string
  success: boolean
}

export interface HubRegistryDTO {
  authScheme: AuthScheme
  entryCount: number
  error?: string
  hasToken: boolean
  name: string
  status: 'error' | 'ok'
  url: string
}

export interface HubRegistryListResponse {
  registries: HubRegistryDTO[]
}
