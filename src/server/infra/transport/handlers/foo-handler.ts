import {join} from 'node:path'

import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IGitService} from '../../../core/interfaces/services/i-git-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {FooEvents, type FooInitResponse} from '../../../../shared/transport/events/foo-events.js'
import {NotAuthenticatedError} from '../../../core/domain/errors/task-error.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface IFooHandlerDeps {
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
  private readonly contextTreeService: IContextTreeService
  private readonly gitService: IGitService
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: IFooHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.gitService = deps.gitService
    this.resolveProjectPath = deps.resolveProjectPath
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, FooInitResponse>(FooEvents.INIT, (_data, clientId) => this.handleInit(clientId))
  }

  private async handleInit(clientId: string): Promise<FooInitResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new NotAuthenticatedError()
    }

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
}
