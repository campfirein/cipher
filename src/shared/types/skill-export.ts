import type {Agent} from './agent.js'

export type SkillExportScope = 'global' | 'project'

export interface SkillExportFailure {
  agent: Agent
  error: string
  scope: SkillExportScope
}

export interface SkillExportUpdate {
  agent: Agent
  path: string
  scope: SkillExportScope
}

export interface SkillExportResult {
  failed: SkillExportFailure[]
  updated: SkillExportUpdate[]
}

export interface SkillBuildAndSyncResult extends SkillExportResult {
  /** Rendered knowledge markdown block — empty string means no knowledge accumulated yet. */
  block: string
}
