import {join} from 'node:path'

import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../core/interfaces/services/i-git-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  type IVcInitResponse,
  type IVcLogRequest,
  type IVcLogResponse,
  type IVcStatusResponse,
  VcEvents,
} from '../../../../shared/transport/events/vc-events.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface IVcHandlerDeps {
  contextTreeService: IContextTreeService
  gitService: IGitService
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

/**
 * Handles vc:* events (Version Control commands).
 */
export class VcHandler {
  private readonly contextTreeService: IContextTreeService
  private readonly gitService: IGitService
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: IVcHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.gitService = deps.gitService
    this.resolveProjectPath = deps.resolveProjectPath
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, IVcInitResponse>(VcEvents.INIT, (_data, clientId) => this.handleInit(clientId))
    this.transport.onRequest<IVcLogRequest, IVcLogResponse>(VcEvents.LOG, (data, clientId) =>
      this.handleLog(data, clientId),
    )
    this.transport.onRequest<void, IVcStatusResponse>(VcEvents.STATUS, (_data, clientId) => this.handleStatus(clientId))
  }

  private async handleInit(clientId: string): Promise<IVcInitResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    // 1. Ensure context tree directory exists
    const contextTreeDir = await this.contextTreeService.initialize(projectPath)

    // 2. Git init — always call (idempotent, like real `git init`).
    //    Check beforehand to determine whether this is a fresh init or a reinit.
    const reinitialized = await this.gitService.isInitialized({directory: contextTreeDir})
    await this.gitService.init({defaultBranch: 'main', directory: contextTreeDir})

    return {
      gitDir: join(contextTreeDir, '.git'),
      reinitialized,
    }
  }

  private async handleLog(data: IVcLogRequest, clientId: string): Promise<IVcLogResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const contextTreeDir = this.contextTreeService.resolvePath(projectPath)

    const gitInitialized = await this.gitService.isInitialized({directory: contextTreeDir})
    if (!gitInitialized) {
      throw new Error('Git repository not initialized. Run "brv vc init" first.')
    }

    const actualCurrentBranch = await this.gitService.getCurrentBranch({directory: contextTreeDir})

    let commits: Awaited<ReturnType<typeof this.gitService.log>>
    let displayBranch: string | undefined

    if (data.all) {
      const branches = await this.gitService.listBranches({directory: contextTreeDir})
      const commitsByBranch = await Promise.all(
        branches.map((branch) => this.gitService.log({depth: data.limit, directory: contextTreeDir, ref: branch.name})),
      )
      const seen = new Set<string>()
      const merged = commitsByBranch
        .flat()
        .filter((c) => {
          if (seen.has(c.sha)) return false
          seen.add(c.sha)
          return true
        })
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      commits = merged.slice(0, data.limit)
      displayBranch = actualCurrentBranch
    } else {
      if (data.ref === undefined) {
        displayBranch = actualCurrentBranch
      } else {
        const branches = await this.gitService.listBranches({directory: contextTreeDir})
        const branchExists = branches.some((b) => b.name === data.ref)
        if (!branchExists) {
          throw new Error(`Branch '${data.ref}' not found`)
        }

        displayBranch = data.ref
      }

      commits = await this.gitService.log({depth: data.limit, directory: contextTreeDir, ref: data.ref})
    }

    return {
      commits: commits.map((c) => ({
        author: c.author,
        message: c.message,
        sha: c.sha,
        timestamp: c.timestamp.toISOString(),
      })),
      currentBranch: displayBranch,
    }
  }

  private async handleStatus(clientId: string): Promise<IVcStatusResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    const contextTreeDir = this.contextTreeService.resolvePath(projectPath)
    const gitInitialized = await this.gitService.isInitialized({directory: contextTreeDir})
    if (!gitInitialized) {
      return {
        initialized: false,
        staged: {added: [], deleted: [], modified: []},
        unstaged: {deleted: [], modified: []},
        untracked: [],
      }
    }

    const branch = await this.gitService.getCurrentBranch({directory: contextTreeDir})
    const gitStatus = await this.gitService.status({directory: contextTreeDir})

    const staged = gitStatus.files.filter((f) => f.staged)
    const unstaged = gitStatus.files.filter((f) => !f.staged && f.status !== 'untracked')

    return {
      branch,
      initialized: true,
      staged: {
        added: staged.filter((f) => f.status === 'added').map((f) => f.path),
        deleted: staged.filter((f) => f.status === 'deleted').map((f) => f.path),
        modified: staged.filter((f) => f.status === 'modified').map((f) => f.path),
      },
      unstaged: {
        deleted: unstaged.filter((f) => f.status === 'deleted').map((f) => f.path),
        modified: unstaged.filter((f) => f.status === 'modified').map((f) => f.path),
      },
      untracked: gitStatus.files.filter((f) => f.status === 'untracked').map((f) => f.path),
    }
  }
}
