import type {Agent} from '../../types/agent.js'
import type {ConnectorType} from '../../types/connector-type.js'
import type {AgentDTO, ConnectorDTO} from '../types/dto.js'

export const ConnectorEvents = {
  GET_AGENT_CONFIG_PATHS: 'connectors:getAgentConfigPaths',
  GET_AGENTS: 'connectors:getAgents',
  INSTALL: 'connectors:install',
  LIST: 'connectors:list',
} as const

export interface ConnectorGetAgentsResponse {
  agents: AgentDTO[]
}

export interface ConnectorListResponse {
  connectors: ConnectorDTO[]
}

export interface ConnectorGetAgentConfigPathsRequest {
  agentId: Agent
}

export interface ConnectorGetAgentConfigPathsResponse {
  configPaths: Partial<Record<ConnectorType, string>>
}

export interface ConnectorInstallRequest {
  agentId: Agent
  connectorType: ConnectorType
}

export interface ConnectorInstallResponse {
  configPath?: string
  manualInstructions?: {configContent: string; guide: string}
  message: string
  requiresManualSetup?: boolean
  success: boolean
}
