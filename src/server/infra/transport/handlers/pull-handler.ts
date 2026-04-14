import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../../../core/interfaces/context-tree/i-context-tree-writer-service.js'
import type {ICogitPullService} from '../../../core/interfaces/services/i-cogit-pull-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  PullEvents,
  type PullExecuteRequest,
  type PullExecuteResponse,
  type PullPrepareRequest,
  type PullPrepareResponse,
} from '../../../../shared/transport/events/pull-events.js'
import {
  LegacySyncUnavailableError,
  LocalChangesExistError,
  NotAuthenticatedError,
  ProjectNotInitError,
} from '../../../core/domain/errors/task-error.js'
import {
  guardAgainstGitVc,
  hasAnyChanges,
  type ProjectBroadcaster,
  type ProjectPathResolver,
  resolveRequiredProjectPath,
} from './handler-types.js'

export interface PullHandlerDeps {
  broadcastToProject: ProjectBroadcaster
  cogitPullService: ICogitPullService
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  contextTreeWriterService: IContextTreeWriterService
  projectConfigStore: IProjectConfigStore
  resolveProjectPath: ProjectPathResolver
  tokenStore: ITokenStore
  transport: ITransportServer
}

/**
 * Handles pull:* events.
 * Business logic for pulling context tree from cloud — no terminal/UI calls.
 */
export class PullHandler {
  private readonly broadcastToProject: ProjectBroadcaster
  private readonly cogitPullService: ICogitPullService
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly contextTreeWriterService: IContextTreeWriterService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: PullHandlerDeps) {
    this.broadcastToProject = deps.broadcastToProject
    this.cogitPullService = deps.cogitPullService
    this.contextTreeService = deps.contextTreeService
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.contextTreeWriterService = deps.contextTreeWriterService
    this.projectConfigStore = deps.projectConfigStore
    this.resolveProjectPath = deps.resolveProjectPath
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<PullPrepareRequest, PullPrepareResponse>(PullEvents.PREPARE, (data, clientId) =>
      this.handlePrepare(data, clientId),
    )

    this.transport.onRequest<PullExecuteRequest, PullExecuteResponse>(PullEvents.EXECUTE, (data, clientId) =>
      this.handleExecute(data, clientId),
    )
  }

  private async handleExecute(data: PullExecuteRequest, clientId: string): Promise<PullExecuteResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    await guardAgainstGitVc({contextTreeService: this.contextTreeService, projectPath})

    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new NotAuthenticatedError()
    }

    const config = await this.projectConfigStore.read(projectPath)
    if (!config) {
      throw new ProjectNotInitError()
    }

    if (!config.teamId || !config.spaceId) {
      throw new LegacySyncUnavailableError()
    }

    // Check for local changes that would be overwritten
    const changes = await this.contextTreeSnapshotService.getChanges(projectPath)
    if (hasAnyChanges(changes)) {
      throw new LocalChangesExistError()
    }

    this.broadcastToProject(projectPath, PullEvents.PROGRESS, {message: 'Pulling from cloud...', step: 'pulling'})

    const snapshot = await this.cogitPullService.pull({
      branch: data.branch,
      sessionKey: token.sessionKey,
      spaceId: config.spaceId,
      teamId: config.teamId,
    })

    this.broadcastToProject(projectPath, PullEvents.PROGRESS, {message: 'Syncing files...', step: 'syncing'})

    const syncResult = await this.contextTreeWriterService.sync({directory: projectPath, files: snapshot.files})
    await this.contextTreeSnapshotService.saveSnapshot(projectPath)

    return {
      added: syncResult.added.length,
      commitSha: snapshot.commitSha,
      deleted: syncResult.deleted.length,
      edited: syncResult.edited.length,
      success: true,
    }
  }

  private async handlePrepare(_data: PullPrepareRequest, clientId: string): Promise<PullPrepareResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    await guardAgainstGitVc({contextTreeService: this.contextTreeService, projectPath})

    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new NotAuthenticatedError()
    }

    const config = await this.projectConfigStore.read(projectPath)
    if (!config) {
      throw new ProjectNotInitError()
    }

    if (!config.teamId || !config.spaceId) {
      throw new LegacySyncUnavailableError()
    }

    const changes = await this.contextTreeSnapshotService.getChanges(projectPath)
    const hasLocalChanges = hasAnyChanges(changes)

    return {
      hasChanges: hasLocalChanges,
      summary: hasLocalChanges ? 'Local changes exist. Push first or reset before pulling.' : 'Ready to pull',
    }
  }
}
