import type {ContextTreeChanges} from '../../../../shared/types/context-tree-changes.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'

import {GitVcInitializedError} from '../../../core/domain/errors/task-error.js'

/**
 * Resolves a transport client ID to its associated project path.
 * Returns undefined for global-scope clients that haven't been associated with a project.
 */
export type ProjectPathResolver = (clientId: string) => string | undefined

/**
 * Resolves the project path for a client, throwing if unavailable.
 * Use this in handlers that REQUIRE a project context.
 *
 * @throws Error when client has no associated project path
 *         (not registered, registration failed, or reconnection lost state)
 */
export function resolveRequiredProjectPath(resolver: ProjectPathResolver, clientId: string): string {
  const projectPath = resolver(clientId)
  if (projectPath === undefined) {
    throw new Error(
      `No project path found for client '${clientId}'. ` +
        'The client may not be registered or its registration was lost during reconnection.',
    )
  }

  return projectPath
}

/**
 * Broadcasts an event to the project-scoped room for a given project path.
 * Silently skips if the project is not registered or routing is unavailable.
 */
export type ProjectBroadcaster = <T = unknown>(projectPath: string, event: string, data: T) => void

/**
 * Returns true if the changes object has any additions, modifications, or deletions.
 */
export function hasAnyChanges(changes: ContextTreeChanges): boolean {
  return changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0
}

/**
 * Throws GitVcInitializedError if the project has Git-based version control initialized.
 * Used by old snapshot-based handlers to block operations when the user has switched to /vc commands.
 */
export async function guardAgainstGitVc(params: {
  contextTreeService: IContextTreeService
  projectPath: string
}): Promise<void> {
  const hasGitVc = await params.contextTreeService.hasGitRepo(params.projectPath)
  if (hasGitVc) {
    throw new GitVcInitializedError('Git-based version control is initialized')
  }
}
