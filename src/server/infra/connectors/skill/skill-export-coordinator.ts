import type {ISkillExportService, SkillExportResult} from '../../../core/interfaces/connectors/i-skill-export-service.js'
import type {SkillKnowledgeBuilder} from './skill-knowledge-builder.js'

// ---------------------------------------------------------------------------
// SkillExportCoordinator
// ---------------------------------------------------------------------------

/**
 * Thin composition layer: builds the knowledge block then syncs it.
 *
 * Injected into ExperienceHookService as a single dependency so the
 * hook constructor stays clean.
 */
export class SkillExportCoordinator {
  constructor(
    private readonly builder: SkillKnowledgeBuilder,
    private readonly service: ISkillExportService,
  ) {}

  /**
   * Build the current knowledge block and sync to all installed targets.
   * Empty blocks are still synced to clean up stale markers after /reset.
   */
  async buildAndSync(): Promise<SkillExportResult> {
    const block = await this.builder.build()

    return this.service.syncInstalledTargets(block)
  }
}
