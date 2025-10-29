import {type Agent} from '../../core/domain/entities/agent.js'
import {type WriteMode} from '../../core/interfaces/i-file-service.js'

/**
 * Configuration for agent-specific rule files.
 */
export type AgentRuleConfig = {
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
export const AGENT_RULE_CONFIGS: Record<Agent, AgentRuleConfig> = {
  Amp: {
    filePath: 'AGENTS.md',
    writeMode: 'append',
  },
  'Augment Code': {
    filePath: '.augment/rules/agent-context-engineering.md',
    writeMode: 'overwrite',
  },
  'Claude Code': {
    filePath: 'CLAUDE.md',
    writeMode: 'append',
  },
  Cline: {
    filePath: '.clinerules/agent-context-engineering.md',
    writeMode: 'overwrite',
  },
  Codex: {
    filePath: 'AGENTS.md',
    writeMode: 'append',
  },
  Cursor: {
    filePath: '.cursor/rules/agent-context-engineering.mdc',
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
    filePath: '.kilocode/rules/agent-context-engineering.md',
    writeMode: 'overwrite',
  },
  Kiro: {
    filePath: '.kiro/steering/agent-context-engineering.md',
    writeMode: 'overwrite',
  },
  Qoder: {
    filePath: '.qoder/rules/agent-context-engineering.md',
    writeMode: 'overwrite',
  },
  'Qwen Code': {
    filePath: 'QWEN.md',
    writeMode: 'append',
  },
  'Roo Code': {
    filePath: '.roo/rules/agent-context-engineering.md',
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
    filePath: '.windsurf/rules/agent-context-engineering.md',
    writeMode: 'overwrite',
  },
  Zed: {
    filePath: 'agent-context-engineering.rules',
    writeMode: 'overwrite',
  },
}
