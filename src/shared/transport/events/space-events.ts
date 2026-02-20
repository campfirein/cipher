import type {BrvConfigDTO, SpaceDTO} from '../types/dto.js'

export const SpaceEvents = {
  LIST: 'space:list',
  SWITCH: 'space:switch',
} as const

export interface TeamWithSpacesDTO {
  spaces: SpaceDTO[]
  teamId: string
  teamName: string
}

export interface SpaceListResponse {
  teams: TeamWithSpacesDTO[]
}

export interface SpaceSwitchRequest {
  spaceId: string
}

export interface SpaceSwitchPullResult {
  added: number
  commitSha: string
  deleted: number
  edited: number
}

export interface SpaceSwitchResponse {
  config: BrvConfigDTO
  pullError?: string
  pullResult?: SpaceSwitchPullResult
  success: boolean
}
