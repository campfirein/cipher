import path from 'node:path'

import type {
  ISkillExportService,
  SkillExportResult,
} from '../../../core/interfaces/connectors/i-skill-export-service.js'
import type {IFileService} from '../../../core/interfaces/services/i-file-service.js'
import type {SkillConnector} from './skill-connector.js'
import type {SkillKnowledgeBuilder} from './skill-knowledge-builder.js'

import {MAIN_SKILL_FILE_NAME} from './skill-connector-config.js'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SkillExportServiceOptions {
  /** Used only for spliceIntoContent() — the knowledge block is pre-built by the caller. */
  builder: SkillKnowledgeBuilder
  fileService: IFileService
  skillConnector: SkillConnector
  /** Static SKILL.md template loaded via SkillContentLoader. */
  staticTemplate: string
}

// ---------------------------------------------------------------------------
// SkillExportService
// ---------------------------------------------------------------------------

/**
 * Syncs a pre-built knowledge block into every installed skill target's SKILL.md.
 *
 * Uses SkillKnowledgeBuilder.spliceIntoContent() to manage the marked
 * `<!-- brv:auto-knowledge -->` block — content outside the markers is never touched.
 */
export class SkillExportService implements ISkillExportService {
  private readonly builder: SkillKnowledgeBuilder
  private readonly fileService: IFileService
  private readonly skillConnector: SkillConnector
  private readonly staticTemplate: string

  constructor(options: SkillExportServiceOptions) {
    this.builder = options.builder
    this.fileService = options.fileService
    this.skillConnector = options.skillConnector
    this.staticTemplate = options.staticTemplate
  }

  async syncInstalledTargets(knowledgeBlock: string): Promise<SkillExportResult> {
    const result: SkillExportResult = {failed: [], updated: []}

    const targets = await this.skillConnector.discoverInstalledTargets()

    await Promise.allSettled(
      targets.map(async (target) => {
        try {
          const skillFilePath = path.join(target.installedPath, MAIN_SKILL_FILE_NAME)

          // Read existing content — only fall back to static template when the
          // file genuinely does not exist (ENOENT).  Permission errors and
          // transient I/O failures propagate to the outer catch so they are
          // recorded in `failed[]` instead of silently overwriting content.
          let existing: string
          try {
            existing = await this.fileService.read(skillFilePath)
          } catch (readError: unknown) {
            const isNotFound =
              readError instanceof Error &&
              ('code' in readError ? (readError as NodeJS.ErrnoException).code === 'ENOENT' : readError.message.includes('ENOENT'))
            if (!isNotFound) {
              throw readError
            }

            existing = this.staticTemplate
          }

          const updatedContent = this.builder.spliceIntoContent(existing, knowledgeBlock)
          await this.fileService.write(updatedContent, skillFilePath, 'overwrite')

          result.updated.push({agent: target.agent, path: skillFilePath, scope: target.scope})
        } catch (error) {
          result.failed.push({
            agent: target.agent,
            error: error instanceof Error ? error.message : String(error),
            scope: target.scope,
          })
        }
      }),
    )

    return result
  }
}
