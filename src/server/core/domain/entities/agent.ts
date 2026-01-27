import type {ConnectorType} from './connector-type.js'

/**
 * Array of all supported Agents.
 */
export const AGENT_VALUES = [
  'Amp',
  'Augment Code',
  'Claude Code',
  'Cline',
  'Codex',
  'Cursor',
  'Gemini CLI',
  'Github Copilot',
  'Junie',
  'Kilo Code',
  'Kiro',
  'Qoder',
  'Qwen Code',
  'Roo Code',
  'Trae.ai',
  'Warp',
  'Windsurf',
  'Zed',
] as const

export type Agent = (typeof AGENT_VALUES)[number]

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
  'Augment Code': {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  'Claude Code': {
    default: 'hook',
    supported: ['rules', 'hook', 'mcp'],
  },
  Cline: {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  Codex: {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  Cursor: {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  'Gemini CLI': {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  'Github Copilot': {
    default: 'mcp',
    supported: ['rules', 'mcp'],
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
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  'Qwen Code': {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  'Roo Code': {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  'Trae.ai': {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  Warp: {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  Windsurf: {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
  Zed: {
    default: 'mcp',
    supported: ['rules', 'mcp'],
  },
}
