import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextFileReader} from '../../../core/interfaces/context-tree/i-context-file-reader.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ICogitPushService} from '../../../core/interfaces/services/i-cogit-push-service.js'
import type {ITrackingService} from '../../../core/interfaces/services/i-tracking-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  PushEvents,
  type PushExecuteRequest,
  type PushExecuteResponse,
  type PushPrepareRequest,
  type PushPrepareResponse,
} from '../../../../shared/transport/events/push-events.js'
import {mapToPushContexts} from '../../cogit/context-tree-to-push-context-mapper.js'

export interface PushHandlerDeps {
  cogitPushService: ICogitPushService
  contextFileReader: IContextFileReader
  contextTreeSnapshotService: IContextTreeSnapshotService
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  trackingService: ITrackingService
  transport: ITransportServer
}

/**
 * Handles push:* events.
 * Business logic for pushing context tree to cloud — no terminal/UI calls.
 */
export class PushHandler {
  private readonly cogitPushService: ICogitPushService
  private readonly contextFileReader: IContextFileReader
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService
  private readonly transport: ITransportServer

  constructor(deps: PushHandlerDeps) {
    this.cogitPushService = deps.cogitPushService
    this.contextFileReader = deps.contextFileReader
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.projectConfigStore = deps.projectConfigStore
    this.tokenStore = deps.tokenStore
    this.trackingService = deps.trackingService
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<PushPrepareRequest, PushPrepareResponse>(PushEvents.PREPARE, (data) =>
      this.handlePrepare(data),
    )

    this.transport.onRequest<PushExecuteRequest, PushExecuteResponse>(PushEvents.EXECUTE, (data) =>
      this.handleExecute(data),
    )
  }

  private async handleExecute(data: PushExecuteRequest): Promise<PushExecuteResponse> {
    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new Error('Not authenticated')
    }

    const config = await this.projectConfigStore.read()
    if (!config) {
      throw new Error('Project not initialized')
    }

    this.transport.broadcast(PushEvents.PROGRESS, {message: 'Reading files...', step: 'reading'})

    const changes = await this.contextTreeSnapshotService.getChanges()
    const [addedFiles, modifiedFiles] = await Promise.all([
      this.contextFileReader.readMany(changes.added),
      this.contextFileReader.readMany(changes.modified),
    ])

    const pushContexts = mapToPushContexts({
      addedFiles,
      deletedPaths: changes.deleted,
      modifiedFiles,
    })

    this.transport.broadcast(PushEvents.PROGRESS, {message: 'Pushing to cloud...', step: 'pushing'})

    await this.cogitPushService.push({
      accessToken: token.accessToken,
      branch: data.branch,
      contexts: pushContexts,
      sessionKey: token.sessionKey,
      spaceId: config.spaceId,
      teamId: config.teamId,
    })

    await this.contextTreeSnapshotService.saveSnapshot()
    await this.trackingService.track('mem:push')

    return {success: true}
  }

  private async handlePrepare(_data: PushPrepareRequest): Promise<PushPrepareResponse> {
    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new Error('Not authenticated')
    }

    if (!(await this.projectConfigStore.exists())) {
      throw new Error('Project not initialized')
    }

    const hasSnapshot = await this.contextTreeSnapshotService.hasSnapshot()
    if (!hasSnapshot) {
      await this.contextTreeSnapshotService.initEmptySnapshot()
    }

    const changes = await this.contextTreeSnapshotService.getChanges()
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
}
