import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../../../core/interfaces/context-tree/i-context-tree-writer-service.js'
import type {ICogitPullService} from '../../../core/interfaces/services/i-cogit-pull-service.js'
import type {ITrackingService} from '../../../core/interfaces/services/i-tracking-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  PullEvents,
  type PullExecuteRequest,
  type PullExecuteResponse,
  type PullPrepareRequest,
  type PullPrepareResponse,
} from '../../../../shared/transport/events/pull-events.js'

export interface PullHandlerDeps {
  cogitPullService: ICogitPullService
  contextTreeSnapshotService: IContextTreeSnapshotService
  contextTreeWriterService: IContextTreeWriterService
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  trackingService: ITrackingService
  transport: ITransportServer
}

/**
 * Handles pull:* events.
 * Business logic for pulling context tree from cloud — no terminal/UI calls.
 */
export class PullHandler {
  private readonly cogitPullService: ICogitPullService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly contextTreeWriterService: IContextTreeWriterService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService
  private readonly transport: ITransportServer

  constructor(deps: PullHandlerDeps) {
    this.cogitPullService = deps.cogitPullService
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.contextTreeWriterService = deps.contextTreeWriterService
    this.projectConfigStore = deps.projectConfigStore
    this.tokenStore = deps.tokenStore
    this.trackingService = deps.trackingService
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<PullPrepareRequest, PullPrepareResponse>(PullEvents.PREPARE, (data) =>
      this.handlePrepare(data),
    )

    this.transport.onRequest<PullExecuteRequest, PullExecuteResponse>(PullEvents.EXECUTE, (data) =>
      this.handleExecute(data),
    )
  }

  private async handleExecute(data: PullExecuteRequest): Promise<PullExecuteResponse> {
    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new Error('Not authenticated')
    }

    const config = await this.projectConfigStore.read()
    if (!config) {
      throw new Error('Project not initialized')
    }

    // Check for local changes that would be overwritten
    const changes = await this.contextTreeSnapshotService.getChanges()
    const hasLocalChanges = changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0
    if (hasLocalChanges) {
      throw new Error('Local changes exist. Push first or reset before pulling.')
    }

    this.transport.broadcast(PullEvents.PROGRESS, {message: 'Pulling from cloud...', step: 'pulling'})

    const snapshot = await this.cogitPullService.pull({
      branch: data.branch,
      sessionKey: token.sessionKey,
      spaceId: config.spaceId,
      teamId: config.teamId,
    })

    this.transport.broadcast(PullEvents.PROGRESS, {message: 'Syncing files...', step: 'syncing'})

    await this.contextTreeWriterService.sync({files: snapshot.files})
    await this.contextTreeSnapshotService.saveSnapshot()
    await this.trackingService.track('mem:pull')

    return {success: true}
  }

  private async handlePrepare(_data: PullPrepareRequest): Promise<PullPrepareResponse> {
    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new Error('Not authenticated')
    }

    if (!(await this.projectConfigStore.exists())) {
      throw new Error('Project not initialized')
    }

    const changes = await this.contextTreeSnapshotService.getChanges()
    const hasLocalChanges = changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0

    return {
      hasChanges: hasLocalChanges,
      summary: hasLocalChanges ? 'Local changes exist. Push first or reset before pulling.' : 'Ready to pull',
    }
  }
}
