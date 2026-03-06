import {join} from 'node:path'

import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../core/interfaces/services/i-git-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {FooEvents, type FooInitRequest, type FooInitResponse} from '../../../../shared/transport/events/foo-events.js'
import {NotAuthenticatedError} from '../../../core/domain/errors/task-error.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface FooHandlerDeps {
  buildRemoteUrl: (teamId: string, spaceId: string) => string
  contextTreeService: IContextTreeService
  gitService: IGitService
  resolveProjectPath: ProjectPathResolver
  tokenStore: ITokenStore
  transport: ITransportServer
}

/**
 * Handles foo:* events.
 * Demo handler for Git Semantics (ENG-684) — internal showcase.
 * Does NOT modify the existing InitHandler or TUI flow.
 */
export class FooHandler {
  private readonly buildRemoteUrl: (teamId: string, spaceId: string) => string
  private readonly contextTreeService: IContextTreeService
  private readonly gitService: IGitService
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: FooHandlerDeps) {
    this.buildRemoteUrl = deps.buildRemoteUrl
    this.contextTreeService = deps.contextTreeService
    this.gitService = deps.gitService
    this.resolveProjectPath = deps.resolveProjectPath
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<FooInitRequest, FooInitResponse>(FooEvents.INIT, (data, clientId) =>
      this.handleInit(data, clientId),
    )
  }

  private async handleInit(data: FooInitRequest, clientId: string): Promise<FooInitResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new NotAuthenticatedError()
    }

    // 1. Ensure context tree directory exists
    const contextTreeDir = await this.contextTreeService.initialize(projectPath)

    // 2. Git init (idempotent — skip if repo already exists)
    const repoExists = await this.gitService.isInitialized({directory: contextTreeDir})
    if (!repoExists) {
      await this.gitService.init({defaultBranch: 'main', directory: contextTreeDir})
      await this.gitService.add({directory: contextTreeDir, filePaths: ['.']})
      await this.gitService.commit({directory: contextTreeDir, message: 'Initialize context tree'})
    }

    // 3. Add remote (idempotent — skip if 'origin' already configured)
    const remoteUrl = this.buildRemoteUrl(data.teamId, data.spaceId)
    const remotes = await this.gitService.listRemotes({directory: contextTreeDir})
    if (!remotes.some((r) => r.remote === 'origin')) {
      await this.gitService.addRemote({directory: contextTreeDir, remote: 'origin', url: remoteUrl})
    }

    return {
      gitDir: join(contextTreeDir, '.git'),
      remoteUrl,
    }
  }
}
