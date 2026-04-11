import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  type SourceAddRequest,
  type SourceAddResponse,
  SourceEvents,
  type SourceListRequest,
  type SourceListResponse,
  type SourceRemoveRequest,
  type SourceRemoveResponse,
} from '../../../../shared/transport/events/source-events.js'
import {addSource, listSourceStatuses, removeSource} from '../../../core/domain/source/source-operations.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface SourceHandlerDeps {
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

export class SourceHandler {
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: SourceHandlerDeps) {
    this.resolveProjectPath = deps.resolveProjectPath
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<SourceAddRequest, SourceAddResponse>(
      SourceEvents.ADD,
      async (data, clientId) => {
        const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
        const result = addSource(projectPath, data.targetPath, data.alias)
        return {
          message: result.message,
          success: result.success,
        }
      },
    )

    this.transport.onRequest<SourceRemoveRequest, SourceRemoveResponse>(
      SourceEvents.REMOVE,
      async (data, clientId) => {
        const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
        const result = removeSource(projectPath, data.aliasOrPath)
        return {
          message: result.message,
          success: result.success,
        }
      },
    )

    this.transport.onRequest<SourceListRequest, SourceListResponse>(
      SourceEvents.LIST,
      async (_data, clientId) => {
        const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
        const result = listSourceStatuses(projectPath)
        return {
          error: result.error,
          statuses: result.statuses,
        }
      },
    )
  }
}
