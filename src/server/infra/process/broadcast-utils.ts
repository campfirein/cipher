import type {IProjectRegistry} from '../../core/interfaces/project/i-project-registry.js'
import type {IProjectRouter} from '../../core/interfaces/routing/i-project-router.js'

/**
 * Broadcast an event to the project-scoped room for a given projectPath.
 * Silently skips if projectPath is unavailable, project not registered,
 * or routing infrastructure is not configured.
 *
 * @param projectRegistry - Project registry for path lookup
 * @param projectRouter - Router for room-scoped broadcasting
 * @param projectPath - The project path to broadcast to
 * @param event - The event name
 * @param data - The event payload
 * @param except - Optional client ID to exclude from the broadcast (prevents
 *                 duplicates when the client already receives via sendTo)
 */
// eslint-disable-next-line max-params
export function broadcastToProjectRoom<T = unknown>(
  projectRegistry: IProjectRegistry | undefined,
  projectRouter: IProjectRouter | undefined,
  projectPath: string | undefined,
  event: string,
  data: T,
  except?: string,
): void {
  if (!projectPath || !projectRouter || !projectRegistry) return
  const projectInfo = projectRegistry.get(projectPath)
  if (projectInfo) {
    projectRouter.broadcastToProject(projectInfo.sanitizedPath, event, data, except)
  }
}
