import {ExperienceStore} from '../../context-tree/experience-store.js'
import {FsFileService} from '../../file/fs-file-service.js'
import {SkillConnector} from './skill-connector.js'
import {SkillContentLoader} from './skill-content-loader.js'
import {SkillExportCoordinator} from './skill-export-coordinator.js'
import {SkillExportService} from './skill-export-service.js'
import {SkillKnowledgeBuilder} from './skill-knowledge-builder.js'

export interface SkillExportStack {
  builder: SkillKnowledgeBuilder
  coordinator: SkillExportCoordinator
  service: SkillExportService
  store: ExperienceStore
}

let staticTemplatePromise: Promise<string> | undefined

async function loadStaticTemplate(fileService: FsFileService): Promise<string> {
  if (!staticTemplatePromise) {
    const skillContentLoader = new SkillContentLoader(fileService)
    staticTemplatePromise = skillContentLoader.loadSkillFile('SKILL.md').catch((error: unknown) => {
      staticTemplatePromise = undefined
      throw error
    })
  }

  return staticTemplatePromise
}

/**
 * Single assembly point for the skill export stack.
 *
 * Constructs all services from a resolved project root.
 * Used by: agent-process hook wiring, connectors:sync handler, CLI command.
 */
export async function createSkillExportStack(projectRoot: string): Promise<SkillExportStack> {
  const fileService = new FsFileService()
  const staticTemplate = await loadStaticTemplate(fileService)
  const store = new ExperienceStore(projectRoot)
  const builder = new SkillKnowledgeBuilder(store)
  const skillConnector = new SkillConnector({fileService, projectRoot})
  const service = new SkillExportService({
    builder,
    fileService,
    skillConnector,
    staticTemplate,
  })
  const coordinator = new SkillExportCoordinator(builder, service)
  return {builder, coordinator, service, store}
}
