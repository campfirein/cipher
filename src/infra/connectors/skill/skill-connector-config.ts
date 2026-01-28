import type {Agent} from '../../../core/domain/entities/agent.js'

/**
 * Scope for skill connector configuration.
 * - 'project': Path relative to project root
 * - 'global': Path relative to user home directory
 */
export type SkillConfigScope = 'global' | 'project'

/**
 * Configuration for agent-specific skill file directories.
 */
export type SkillConnectorConfig = {
  /** Base directory for skill files (relative to scope root) */
  basePath: string
  /** Whether path is relative to project root or home dir */
  scope: SkillConfigScope
}

/**
 * Agent-specific skill connector configurations.
 * Maps each supported agent to its skill directory path and scope.
 */
export const SKILL_CONNECTOR_CONFIGS = {
  'Claude Code': {
    basePath: '.claude/skills/byterover',
    scope: 'project',
  },
  Codex: {
    basePath: '.codex/skills/byterover',
    scope: 'global',
  },
  Cursor: {
    basePath: '.cursor/skills/byterover',
    scope: 'project',
  },
  'Github Copilot': {
    basePath: '.github/skills/byterover',
    scope: 'project',
  },
} as const satisfies Partial<Record<Agent, SkillConnectorConfig>>

/**
 * Type representing agents that have skill connector support.
 */
export type SkillSupportedAgent = keyof typeof SKILL_CONNECTOR_CONFIGS

/**
 * Names of the skill files written by the skill connector.
 */
export const SKILL_FILE_NAMES = ['SKILL.md', 'TROUBLESHOOTING.md', 'WORKFLOWS.md'] as const
