import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextFileReader} from '../../../core/interfaces/context-tree/i-context-file-reader.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ICogitPushService} from '../../../core/interfaces/services/i-cogit-push-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'
import type {ProjectBroadcaster, ProjectPathResolver} from './handler-types.js'

import {
  PushEvents,
  type PushExecuteRequest,
  type PushExecuteResponse,
  type PushPrepareRequest,
  type PushPrepareResponse,
} from '../../../../shared/transport/events/push-events.js'
import {
  NotAuthenticatedError,
  ProjectNotInitError,
  SpaceNotConfiguredError,
} from '../../../core/domain/errors/task-error.js'
import {mapToPushContexts} from '../../cogit/context-tree-to-push-context-mapper.js'

export interface PushHandlerDeps {
  broadcastToProject: ProjectBroadcaster
  cogitPushService: ICogitPushService
  contextFileReader: IContextFileReader
  contextTreeSnapshotService: IContextTreeSnapshotService
  projectConfigStore: IProjectConfigStore
  resolveProjectPath: ProjectPathResolver
  tokenStore: ITokenStore
  transport: ITransportServer
}

/**
 * Handles push:* events.
 * Business logic for pushing context tree to cloud — no terminal/UI calls.
 */
export class PushHandler {
  private readonly broadcastToProject: ProjectBroadcaster
  private readonly cogitPushService: ICogitPushService
  private readonly contextFileReader: IContextFileReader
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: PushHandlerDeps) {
    this.broadcastToProject = deps.broadcastToProject
    this.cogitPushService = deps.cogitPushService
    this.contextFileReader = deps.contextFileReader
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.projectConfigStore = deps.projectConfigStore
    this.resolveProjectPath = deps.resolveProjectPath
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<PushPrepareRequest, PushPrepareResponse>(PushEvents.PREPARE, (data, clientId) =>
      this.handlePrepare(data, clientId),
    )

    this.transport.onRequest<PushExecuteRequest, PushExecuteResponse>(PushEvents.EXECUTE, (data, clientId) =>
      this.handleExecute(data, clientId),
    )
  }

  private async handleExecute(data: PushExecuteRequest, clientId: string): Promise<PushExecuteResponse> {
    const projectPath = this.resolveEffectivePath(clientId)

    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new NotAuthenticatedError()
    }

    const config = await this.projectConfigStore.read(projectPath)
    if (!config) {
      throw new ProjectNotInitError()
    }

    if (!config.teamId || !config.spaceId) {
      throw new SpaceNotConfiguredError()
    }

    this.broadcastToProject(projectPath, PushEvents.PROGRESS, {message: 'Reading context files...', step: 'reading'})

    const changes = await this.contextTreeSnapshotService.getChanges(projectPath)
    const [addedFiles, modifiedFiles] = await Promise.all([
      this.contextFileReader.readMany(changes.added, projectPath),
      this.contextFileReader.readMany(changes.modified, projectPath),
    ])

    const pushContexts = mapToPushContexts({
      addedFiles,
      deletedPaths: changes.deleted,
      modifiedFiles,
    })

    this.broadcastToProject(projectPath, PushEvents.PROGRESS, {message: 'Pushing to cloud...', step: 'pushing'})

    await this.cogitPushService.push({
      accessToken: token.accessToken,
      branch: data.branch,
      contexts: pushContexts,
      sessionKey: token.sessionKey,
      spaceId: config.spaceId,
      teamId: config.teamId,
    })

    await this.contextTreeSnapshotService.saveSnapshot(projectPath)

    return {success: true}
  }

  private async handlePrepare(_data: PushPrepareRequest, clientId: string): Promise<PushPrepareResponse> {
    const projectPath = this.resolveEffectivePath(clientId)

    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new NotAuthenticatedError()
    }

    if (!(await this.projectConfigStore.exists(projectPath))) {
      throw new ProjectNotInitError()
    }

    const hasSnapshot = await this.contextTreeSnapshotService.hasSnapshot(projectPath)
    if (!hasSnapshot) {
      await this.contextTreeSnapshotService.initEmptySnapshot(projectPath)
    }

    const changes = await this.contextTreeSnapshotService.getChanges(projectPath)
    const totalChanges = changes.added.length + changes.modified.length + changes.deleted.length

    const parts: string[] = []
    if (changes.added.length > 0) parts.push(`${changes.added.length} added`)
    if (changes.modified.length > 0) parts.push(`${changes.modified.length} modified`)
    if (changes.deleted.length > 0) parts.push(`${changes.deleted.length} deleted`)

    return {
      fileCount: totalChanges,
      hasChanges: totalChanges > 0,
      summary: parts.length > 0 ? parts.join(', ') : 'No changes',
    }
  }

  private resolveEffectivePath(clientId: string): string {
    return this.resolveProjectPath(clientId) ?? process.cwd()
  }
}
