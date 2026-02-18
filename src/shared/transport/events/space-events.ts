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

export interface SpaceSwitchResponse {
  config: BrvConfigDTO
  success: boolean
}
