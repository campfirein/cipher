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
  Amp: {default: 'rules', supported: ['rules']},
  'Augment Code': {default: 'rules', supported: ['rules']},
  'Claude Code': {default: 'hook', supported: ['rules', 'hook']},
  Cline: {default: 'rules', supported: ['rules']},
  Codex: {default: 'rules', supported: ['rules']},
  Cursor: {default: 'rules', supported: ['rules']},
  'Gemini CLI': {default: 'rules', supported: ['rules']},
  'Github Copilot': {default: 'rules', supported: ['rules']},
  Junie: {default: 'rules', supported: ['rules']},
  'Kilo Code': {default: 'rules', supported: ['rules']},
  Kiro: {default: 'rules', supported: ['rules']},
  Qoder: {default: 'rules', supported: ['rules']},
  'Qwen Code': {default: 'rules', supported: ['rules']},
  'Roo Code': {default: 'rules', supported: ['rules']},
  'Trae.ai': {default: 'rules', supported: ['rules']},
  Warp: {default: 'rules', supported: ['rules']},
  Windsurf: {default: 'rules', supported: ['rules']},
  Zed: {default: 'rules', supported: ['rules']},
}
