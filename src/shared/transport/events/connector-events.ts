import type {Agent} from '../../types/agent.js'
import type {ConnectorType} from '../../types/connector-type.js'
import type {AgentDTO, ConnectorDTO} from '../types/dto.js'

export const ConnectorEvents = {
  DETECT_AGENTS: 'connectors:detectAgents',
  GET_AGENT_CONFIG_PATHS: 'connectors:getAgentConfigPaths',
  GET_AGENTS: 'connectors:getAgents',
  INSTALL: 'connectors:install',
  INSTALL_BUNDLE: 'connectors:installBundle',
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

export type ConnectorInstallBundleRequest = {
  agentId: Agent
}

export type ConnectorBundleInstalledStep = {
  artifact: string
  path: string
}

export type ConnectorBundleSkippedStep = {
  artifact: string
  reason: string
}

export type ConnectorInstallBundleResponse = {
  agent?: Agent
  installed: ConnectorBundleInstalledStep[]
  message: string
  projectPath?: string
  skipped: ConnectorBundleSkippedStep[]
  success: boolean
}

export type ConnectorDetectedAgent = {
  agent: Agent
  evidence: string
}

export type ConnectorDetectAgentsRequest = Record<string, never>

export type ConnectorDetectAgentsResponse = {
  detected: ConnectorDetectedAgent[]
  projectPath: string
}
