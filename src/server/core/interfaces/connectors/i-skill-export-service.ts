import type {Agent} from '../../domain/entities/agent.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A concrete installed skill location to sync knowledge into.
 * One agent may appear in multiple targets if both project and global installs exist.
 */
export interface SkillExportTarget {
  agent: Agent
  /** Absolute path to the skill directory (e.g. /project/.claude/skills/byterover/) */
  installedPath: string
  scope: 'global' | 'project'
}

/**
 * Outcome of a sync operation across all installed targets.
 */
export interface SkillExportResult {
  failed: Array<{agent: string; error: string; scope: 'global' | 'project'}>
  updated: Array<{agent: string; path: string; scope: 'global' | 'project'}>
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Syncs a pre-built knowledge block into all installed skill targets.
 */
export interface ISkillExportService {
  syncInstalledTargets(knowledgeBlock: string): Promise<SkillExportResult>
}
