import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  type WorkspaceAddRequest,
  WorkspaceEvents,
  type WorkspaceOperationResponse,
  type WorkspaceRemoveRequest,
} from '../../../../shared/transport/events/workspace-events.js'
import {addWorkspace, removeWorkspace} from '../../../core/domain/knowledge/workspaces-operations.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface WorkspaceHandlerDeps {
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

export class WorkspaceHandler {
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: WorkspaceHandlerDeps) {
    this.resolveProjectPath = deps.resolveProjectPath
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<WorkspaceAddRequest, WorkspaceOperationResponse>(
      WorkspaceEvents.ADD,
      (data, clientId) => this.handleAdd(data, clientId),
    )

    this.transport.onRequest<WorkspaceRemoveRequest, WorkspaceOperationResponse>(
      WorkspaceEvents.REMOVE,
      (data, clientId) => this.handleRemove(data, clientId),
    )
  }

  private handleAdd(data: WorkspaceAddRequest, clientId: string): WorkspaceOperationResponse {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    return addWorkspace(projectPath, data.targetPath)
  }

  private handleRemove(data: WorkspaceRemoveRequest, clientId: string): WorkspaceOperationResponse {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    return removeWorkspace(projectPath, data.path)
  }
}
