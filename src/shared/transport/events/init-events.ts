import type {AgentDTO, BrvConfigDTO, SpaceDTO, TeamDTO} from '../types/dto.js'

export const InitEvents = {
  COMPLETED: 'init:completed',
  EXECUTE: 'init:execute',
  GET_AGENTS: 'init:getAgents',
  GET_SPACES: 'init:getSpaces',
  GET_TEAMS: 'init:getTeams',
  PROGRESS: 'init:progress',
} as const

export interface InitGetTeamsResponse {
  teams: TeamDTO[]
}

export interface InitGetSpacesRequest {
  teamId: string
}

export interface InitGetSpacesResponse {
  spaces: SpaceDTO[]
}

export interface InitGetAgentsResponse {
  agents: AgentDTO[]
}

export interface InitExecuteRequest {
  agentId: string
  connectorType: string
  force?: boolean
  spaceId: string
  teamId: string
}

export interface InitExecuteResponse {
  success: boolean
}

export interface InitProgressEvent {
  message: string
  step: string
}

export interface InitCompletedEvent {
  config?: BrvConfigDTO
  success: boolean
}
