/**
 * Data Transfer Objects (DTOs)
 *
 * Plain serializable types for data exchanged between TUI and Server.
 */

import type {Agent} from '../../types/agent.js'
import type {ConnectorType} from '../../types/connector-type.js'
import type {ContextTreeChanges} from '../../types/context-tree-changes.js'

// ============================================================================
// Auth DTOs
// ============================================================================

export interface UserDTO {
  email: string
  hasOnboardedCli: boolean
  id: string
}

export interface AuthTokenDTO {
  accessToken: string
  expiresAt: string
}

// ============================================================================
// Config DTOs
// ============================================================================

export interface BrvConfigDTO {
  spaceId: string
  spaceName: string
  teamId: string
  teamName: string
  version: string
}

// ============================================================================
// Team & Space DTOs
// ============================================================================

export interface TeamDTO {
  displayName: string
  id: string
  isDefault: boolean
  name: string
}

export interface SpaceDTO {
  id: string
  isDefault: boolean
  name: string
  teamId: string
  teamName: string
}

// ============================================================================
// Agent & Connector DTOs
// ============================================================================

export interface AgentDTO {
  defaultConnectorType: ConnectorType
  id: Agent
  name: Agent
  supportedConnectorTypes: ConnectorType[]
}

export interface ConnectorDTO {
  agent: Agent
  connectorType: ConnectorType
  defaultType: ConnectorType
  supportedTypes: ConnectorType[]
}

// ============================================================================
// Provider & Model DTOs
// ============================================================================

export interface ProviderDTO {
  apiKeyUrl?: string
  category: 'other' | 'popular'
  description: string
  id: string
  isConnected: boolean
  isCurrent: boolean
  name: string
  requiresApiKey: boolean
}

export interface ModelDTO {
  contextLength: number
  description?: string
  id: string
  isFree: boolean
  name: string
  pricing: {inputPerM: number; outputPerM: number}
  provider: string
}

// ============================================================================
// Status DTOs
// ============================================================================

export interface StatusDTO {
  authStatus: 'expired' | 'logged_in' | 'not_logged_in' | 'unknown'
  contextTreeChanges?: ContextTreeChanges
  contextTreeStatus: 'has_changes' | 'no_changes' | 'not_initialized' | 'unknown'
  currentDirectory: string
  projectInitialized: boolean
  spaceName?: string
  teamName?: string
  userEmail?: string
}
