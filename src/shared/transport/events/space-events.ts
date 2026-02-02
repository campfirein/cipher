import type {BrvConfigDTO, SpaceDTO} from '../types/dto.js'

export const SpaceEvents = {
  LIST: 'space:list',
  SWITCH: 'space:switch',
} as const

export interface SpaceListResponse {
  spaces: SpaceDTO[]
}

export interface SpaceSwitchRequest {
  spaceId: string
}

export interface SpaceSwitchResponse {
  config: BrvConfigDTO
  success: boolean
}
