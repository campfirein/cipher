import type {HubEntryDTO} from '../types/dto.js'

export const HubEvents = {
  INSTALL: 'hub:install',
  LIST: 'hub:list',
} as const

export interface HubListResponse {
  entries: HubEntryDTO[]
  version: string
}

export interface HubInstallRequest {
  agent?: string
  entryId: string
}

export interface HubInstallResponse {
  installedFiles: string[]
  message: string
  success: boolean
}
