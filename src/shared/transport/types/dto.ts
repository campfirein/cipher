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
  spaceId?: string
  spaceName?: string
  teamId?: string
  teamName?: string
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
  authMethod?: 'api-key' | 'oauth'
  category: 'other' | 'popular'
  description: string
  id: string
  isConnected: boolean
  isCurrent: boolean
  name: string
  oauthCallbackMode?: 'auto' | 'code-paste'
  oauthLabel?: string
  requiresApiKey: boolean
  supportsOAuth: boolean
}

export interface ModelDTO {
  contextLength: number
  description?: string
  id: string
  isFree: boolean
  name: string
  pricing: {inputPerM: number; outputPerM: number}
  provider: string
  providerId: string
}

// ============================================================================
// Hub DTOs
// ============================================================================

export interface HubEntryDTO {
  author: {name: string; url: string}
  category: string
  dependencies: string[]
  description: string
  file_tree: Array<{name: string; url: string}>
  id: string
  license: string
  long_description: string
  manifest_url: string
  metadata: {use_cases: string[]}
  name: string
  path_url: string
  readme_url: string
  registry?: string
  tags: string[]
  type: 'agent-skill' | 'bundle'
  version: string
}

// ============================================================================
// Status DTOs
// ============================================================================

export interface ProjectLocationDTO {
  /** Absolute path to the context tree directory (e.g., '/Users/foo/project/.brv/context-tree') */
  contextTreePath: string
  /** True if this project has connected clients/agents or is the current project */
  isActive: boolean
  /** True if this is the project the client is currently running from */
  isCurrent: boolean
  /** True if .brv/context-tree exists */
  isInitialized: boolean
  projectPath: string
}

export interface StatusDTO {
  authStatus: 'expired' | 'logged_in' | 'not_logged_in' | 'unknown'
  contextTreeChanges?: ContextTreeChanges
  /** Absolute path to the context tree directory (e.g., '/Users/foo/project/.brv/context-tree') */
  contextTreeDir?: string
  /** Relative path to the context tree directory from project root (e.g., '.brv/context-tree') */
  contextTreeRelativeDir?: string
  contextTreeStatus: 'has_changes' | 'no_changes' | 'not_initialized' | 'unknown'
  currentDirectory: string
  spaceName?: string
  teamName?: string
  userEmail?: string
}
