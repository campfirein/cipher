import {rm} from 'node:fs/promises'
import {join} from 'node:path'

import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {ResetEvents, type ResetExecuteResponse} from '../../../../shared/transport/events/reset-events.js'
import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../constants.js'

export interface ResetHandlerDeps {
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  transport: ITransportServer
}

/**
 * Handles reset:execute event.
 * Deletes and re-initializes the context tree — no terminal/UI calls.
 */
export class ResetHandler {
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly transport: ITransportServer

  constructor(deps: ResetHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, ResetExecuteResponse>(ResetEvents.EXECUTE, () => this.handleExecute())
  }

  private async handleExecute(): Promise<ResetExecuteResponse> {
    const exists = await this.contextTreeService.exists()
    if (!exists) {
      throw new Error('Context tree not initialized')
    }

    const contextTreePath = join(process.cwd(), BRV_DIR, CONTEXT_TREE_DIR)
    await rm(contextTreePath, {force: true, recursive: true})
    await this.contextTreeService.initialize()
    await this.contextTreeSnapshotService.initEmptySnapshot()

    return {success: true}
  }
}
