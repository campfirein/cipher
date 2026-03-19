import type {SkillExportResult} from '../../../../shared/types/skill-export.js'
import type {Agent} from '../../domain/entities/agent.js'

export type {SkillBuildAndSyncResult, SkillExportResult} from '../../../../shared/types/skill-export.js'

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
 * Syncs a pre-built knowledge block into all installed skill targets.
 */
export interface ISkillExportService {
  syncInstalledTargets(knowledgeBlock: string): Promise<SkillExportResult>
}
