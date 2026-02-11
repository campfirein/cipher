import type {ConnectorType} from './connector-type.js'

export {type Agent, AGENT_VALUES} from '../../../../shared/types/agent.js'

// Re-import Agent for use in this file's type definitions
import {type Agent, AGENT_VALUES} from '../../../../shared/types/agent.js'

const agentSet: ReadonlySet<string> = new Set(AGENT_VALUES)

export function isAgent(value: string): value is Agent {
  return agentSet.has(value)
}

/**
 * Connector availability configuration for an agent.
 */
type AgentConnectorConfig = {
  /** The default connector type for this agent */
  default: ConnectorType
  /** Connector types supported by this agent */
  supported: readonly ConnectorType[]
}

/**
 * Single source of truth for agent connector configuration.
 * Defines which connectors each agent supports and which is the default.
 */
export const AGENT_CONNECTOR_CONFIG: Record<Agent, AgentConnectorConfig> = {
  Amp: {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  Antigravity: {
    default: 'rules',
    supported: ['rules', 'mcp'],
  },
  'Augment Code': {
    default: 'rules',
    supported: ['rules', 'mcp'],
  },
  'Claude Code': {
    default: 'skill',
    supported: ['rules', 'hook', 'mcp', 'skill'],
  },
  Cline: {
    default: 'rules',
    supported: ['rules', 'mcp'],
  },
  Codex: {
    default: 'mcp',
    supported: ['rules', 'mcp', 'skill'],
  },
  Cursor: {
    default: 'skill',
    supported: ['rules', 'mcp', 'skill'],
  },
  'Gemini CLI': {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  'Github Copilot': {
    default: 'mcp',
    supported: ['rules', 'mcp', 'skill'],
  },
  Junie: {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  'Kilo Code': {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  Kiro: {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  Qoder: {
    default: 'rules',
    supported: ['rules', 'mcp'],
  },
  'Qwen Code': {
    default: 'rules',
    supported: ['rules', 'mcp'],
  },
  'Roo Code': {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  'Trae.ai': {
    default: 'rules',
    supported: ['rules', 'mcp'],
  },
  Warp: {
    default: 'rules',
    supported: ['rules', 'mcp'],
  },
  Windsurf: {
    default: 'rules',
    supported: ['rules', 'mcp'],
  },
  Zed: {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
}
