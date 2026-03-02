import type {Agent} from '../../../core/domain/entities/agent.js'
import type {WriteMode} from '../../../core/interfaces/services/i-file-service.js'

/**
 * Configuration for agent-specific rule files.
 */
export type RulesConnectorConfig = {
  /**
   * The file path where the agent's rules should be written.
   */
  filePath: string
  /**
   * The write mode to use when writing the rule file.
   */
  writeMode: WriteMode
}

/**
 * Mapping of agents to their rule file configurations.
 */
export const RULES_CONNECTOR_CONFIGS = {
  Amp: {
    filePath: 'AGENTS.md',
    writeMode: 'append',
  },
  Antigravity: {
    filePath: '.agent/rules/agent-context.md',
    writeMode: 'overwrite',
  },
  'Auggie CLI': {
    filePath: '.augment/rules/agent-context.md',
    writeMode: 'overwrite',
  },
  'Augment Code': {
    filePath: '.augment/rules/agent-context.md',
    writeMode: 'overwrite',
  },
  'Claude Code': {
    filePath: 'CLAUDE.md',
    writeMode: 'append',
  },
  Cline: {
    filePath: '.clinerules/agent-context.md',
    writeMode: 'overwrite',
  },
  Codex: {
    filePath: 'AGENTS.md',
    writeMode: 'append',
  },
  Cursor: {
    filePath: '.cursor/rules/agent-context.mdc',
    writeMode: 'overwrite',
  },
  'Gemini CLI': {
    filePath: 'GEMINI.md',
    writeMode: 'append',
  },
  'Github Copilot': {
    filePath: '.github/copilot-instructions.md',
    writeMode: 'append',
  },
  Junie: {
    filePath: '.junie/guidelines.md',
    writeMode: 'append',
  },
  'Kilo Code': {
    filePath: '.kilocode/rules/agent-context.md',
    writeMode: 'overwrite',
  },
  Kiro: {
    filePath: '.kiro/steering/agent-context.md',
    writeMode: 'overwrite',
  },
  OpenCode: {
    filePath: 'AGENTS.md',
    writeMode: 'append',
  },
  Qoder: {
    filePath: '.qoder/rules/agent-context.md',
    writeMode: 'overwrite',
  },
  'Qwen Code': {
    filePath: 'QWEN.md',
    writeMode: 'append',
  },
  'Roo Code': {
    filePath: '.roo/rules/agent-context.md',
    writeMode: 'overwrite',
  },
  'Trae.ai': {
    filePath: 'project_rules.md',
    writeMode: 'append',
  },
  Warp: {
    filePath: 'WARP.md',
    writeMode: 'append',
  },
  Windsurf: {
    filePath: '.windsurf/rules/agent-context.md',
    writeMode: 'overwrite',
  },
  Zed: {
    filePath: 'agent-context.rules',
    writeMode: 'overwrite',
  },
} as const satisfies Partial<Record<Agent, RulesConnectorConfig>>

/**
 * Type for agents that have rules connector configurations.
 */
export type RulesSupportedAgent = keyof typeof RULES_CONNECTOR_CONFIGS
