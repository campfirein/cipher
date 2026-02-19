import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {ResetEvents, type ResetExecuteResponse} from '../../../../shared/transport/events/reset-events.js'
import {ContextTreeNotInitializedError} from '../../../core/domain/errors/task-error.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface ResetHandlerDeps {
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  resolveProjectPath: ProjectPathResolver
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
  private readonly transport: ITransportServer

  constructor(deps: ResetHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.resolveProjectPath = deps.resolveProjectPath
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

    return {success: true}
  }
}
