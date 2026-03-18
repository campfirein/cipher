import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IReviewBackupStore} from '../../../core/interfaces/storage/i-review-backup-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {ResetEvents, type ResetExecuteResponse} from '../../../../shared/transport/events/reset-events.js'
import {ContextTreeNotInitializedError} from '../../../core/domain/errors/task-error.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface ResetHandlerDeps {
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  resolveProjectPath: ProjectPathResolver
  reviewBackupStoreFactory: (projectPath: string) => IReviewBackupStore
  transport: ITransportServer
}

/**
 * Handles reset:execute event.
 * Deletes and re-initializes the context tree — no terminal/UI calls.
 */
export class ResetHandler {
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly reviewBackupStoreFactory: (projectPath: string) => IReviewBackupStore
  private readonly transport: ITransportServer

  constructor(deps: ResetHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.resolveProjectPath = deps.resolveProjectPath
    this.reviewBackupStoreFactory = deps.reviewBackupStoreFactory
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, ResetExecuteResponse>(ResetEvents.EXECUTE, (_data, clientId) =>
      this.handleExecute(clientId),
    )
  }

  private async handleExecute(clientId: string): Promise<ResetExecuteResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    const exists = await this.contextTreeService.exists(projectPath)
    if (!exists) {
      throw new ContextTreeNotInitializedError()
    }

    await this.contextTreeService.delete(projectPath)
    await this.contextTreeService.initialize(projectPath)
    await this.contextTreeSnapshotService.initEmptySnapshot(projectPath)

    // Best-effort: clear review backups on reset so the directory starts fresh
    try {
      await this.reviewBackupStoreFactory(projectPath).clear()
    } catch {
      // Backup cleanup must never block the reset response
    }

    return {success: true}
  }
}
