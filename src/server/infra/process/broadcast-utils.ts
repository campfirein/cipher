import type {IProjectRegistry} from '../../core/interfaces/project/i-project-registry.js'
import type {IProjectRouter} from '../../core/interfaces/routing/i-project-router.js'

/**
 * Broadcast an event to the project-scoped room for a given projectPath.
 * Silently skips if projectPath is unavailable, project not registered,
 * or routing infrastructure is not configured.
 */
export function broadcastToProjectRoom<T = unknown>(
  projectRegistry: IProjectRegistry | undefined,
  projectRouter: IProjectRouter | undefined,
  projectPath: string | undefined,
  event: string,
  data: T,
): void {
  if (!projectPath || !projectRouter || !projectRegistry) return
  const projectInfo = projectRegistry.get(projectPath)
  if (projectInfo) {
    projectRouter.broadcastToProject(projectInfo.sanitizedPath, event, data)
  }
}
