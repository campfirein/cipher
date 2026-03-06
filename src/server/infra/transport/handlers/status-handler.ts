import {join} from 'node:path'

import type {StatusDTO} from '../../../../shared/transport/types/dto.js'
import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../core/interfaces/services/i-git-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {StatusEvents, type StatusGetResponse} from '../../../../shared/transport/events/status-events.js'
import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../constants.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface StatusHandlerDeps {
  contextTreeService: IContextTreeService
  gitService: IGitService
  projectConfigStore: IProjectConfigStore
  resolveProjectPath: ProjectPathResolver
  tokenStore: ITokenStore
  transport: ITransportServer
}

/**
 * Handles status:get event.
 * Collects auth, project, and context tree status — pure data, no terminal output.
 */
export class StatusHandler {
  private readonly contextTreeService: IContextTreeService
  private readonly gitService: IGitService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: StatusHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.gitService = deps.gitService
    this.projectConfigStore = deps.projectConfigStore
    this.resolveProjectPath = deps.resolveProjectPath
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, StatusGetResponse>(StatusEvents.GET, async (_data, clientId) => {
      const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
      const status = await this.collectStatus(projectPath)
      return {status}
    })
  }

  private async collectStatus(projectPath: string): Promise<StatusDTO> {
    const result: StatusDTO = {
      authStatus: 'unknown',
      contextTreeStatus: 'unknown',
      currentDirectory: projectPath,
    }

    // Auth status
    try {
      const token = await this.tokenStore.load()
      if (token !== undefined && token.isValid()) {
        result.authStatus = 'logged_in'
        result.userEmail = token.userEmail
      } else if (token === undefined) {
        result.authStatus = 'not_logged_in'
      } else {
        result.authStatus = 'expired'
      }
    } catch {
      result.authStatus = 'unknown'
    }

    // Project status
    try {
      const isInitialized = await this.projectConfigStore.exists(projectPath)
      if (isInitialized) {
        const config = await this.projectConfigStore.read(projectPath)
        if (config) {
          result.teamName = config.teamName
          result.spaceName = config.spaceName
        }
      }
    } catch {}

    // Context tree status (git-based)
    try {
      const contextTreeExists = await this.contextTreeService.exists(projectPath)
      if (contextTreeExists) {
        const contextTreeDir = join(projectPath, BRV_DIR, CONTEXT_TREE_DIR)
        result.contextTreeDir = contextTreeDir
        result.contextTreeRelativeDir = join(BRV_DIR, CONTEXT_TREE_DIR)

        const gitInitialized = await this.gitService.isInitialized({directory: contextTreeDir})
        if (gitInitialized) {
          result.gitBranch = await this.gitService.getCurrentBranch({directory: contextTreeDir})
          const gitStatus = await this.gitService.status({directory: contextTreeDir})

          if (gitStatus.isClean) {
            result.contextTreeStatus = 'no_changes'
          } else {
            result.contextTreeStatus = 'has_changes'
            const staged = gitStatus.files.filter((f) => f.staged)
            const unstaged = gitStatus.files.filter((f) => !f.staged && f.status !== 'untracked')
            result.gitChanges = {
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
        } else {
          result.contextTreeStatus = 'not_initialized'
        }
      } else {
        result.contextTreeStatus = 'not_initialized'
      }
    } catch {
      result.contextTreeStatus = 'unknown'
    }

    return result
  }
}
