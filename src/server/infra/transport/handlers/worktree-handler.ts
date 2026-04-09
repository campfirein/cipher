import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  type WorktreeAddRequest,
  type WorktreeAddResponse,
  WorktreeEvents,
  type WorktreeListRequest,
  type WorktreeListResponse,
  type WorktreeRemoveRequest,
  type WorktreeRemoveResponse,
} from '../../../../shared/transport/events/worktree-events.js'
import {addWorktree, findParentProject, listWorktrees, removeWorktree, resolveProject} from '../../project/resolve-project.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface WorktreeHandlerDeps {
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

export class WorktreeHandler {
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: WorktreeHandlerDeps) {
    this.resolveProjectPath = deps.resolveProjectPath
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<WorktreeAddRequest, WorktreeAddResponse>(
      WorktreeEvents.ADD,
      async (data, clientId) => {
        // Resolve the parent project from client registration
        let projectPath: string | undefined
        try {
          projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
        } catch {
          // Client not associated — try auto-detect from worktreePath
          projectPath = findParentProject(data.worktreePath)
          if (!projectPath) {
            return {message: 'No parent project found for the target directory.', success: false}
          }
        }

        const result = addWorktree(projectPath, data.worktreePath, {force: data.force})
        return {
          backedUp: result.backedUp,
          message: result.message,
          success: result.success,
        }
      },
    )

    this.transport.onRequest<WorktreeRemoveRequest, WorktreeRemoveResponse>(
      WorktreeEvents.REMOVE,
      async (data) => {
        const targetPath = data?.worktreePath ?? process.cwd()
        const result = removeWorktree(targetPath)
        return {
          message: result.message,
          success: result.success,
        }
      },
    )

    this.transport.onRequest<WorktreeListRequest, WorktreeListResponse>(
      WorktreeEvents.LIST,
      async (_data, clientId) => {
        const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
        const resolution = resolveProject({cwd: projectPath})

        if (!resolution) {
          return {
            projectRoot: projectPath,
            source: 'direct' as const,
            worktreeRoot: projectPath,
            worktrees: [],
          }
        }

        const worktrees = listWorktrees(resolution.projectRoot)
        return {
          projectRoot: resolution.projectRoot,
          source: resolution.source,
          worktreeRoot: resolution.worktreeRoot,
          worktrees,
        }
      },
    )
  }
}
