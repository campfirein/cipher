import {join} from 'node:path'

import type {ProjectLocationDTO} from '../../../../shared/transport/types/dto.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IProjectRegistry} from '../../../core/interfaces/project/i-project-registry.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {LocationsEvents, type LocationsGetResponse} from '../../../../shared/transport/events/locations-events.js'
import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../constants.js'
import {type ProjectPathResolver} from './handler-types.js'

export interface LocationsHandlerDeps {
  contextTreeService: IContextTreeService
  getActiveProjectPaths: () => string[]
  projectRegistry: IProjectRegistry
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

/**
 * Handles locations:get event.
 * Returns all registered project locations with context tree status.
 */
export class LocationsHandler {
  private readonly contextTreeService: IContextTreeService
  private readonly getActiveProjectPaths: () => string[]
  private readonly projectRegistry: IProjectRegistry
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: LocationsHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.getActiveProjectPaths = deps.getActiveProjectPaths
    this.projectRegistry = deps.projectRegistry
    this.resolveProjectPath = deps.resolveProjectPath
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, LocationsGetResponse>(LocationsEvents.GET, async (_data, clientId) => {
      const projectPath = this.resolveProjectPath(clientId)
      try {
        const locations = await this.buildLocations(projectPath)
        return {locations}
      } catch {
        return {locations: []}
      }
    })
  }

  private async buildLocations(currentProjectPath?: string): Promise<ProjectLocationDTO[]> {
    const all = this.projectRegistry.getAll()
    const activeSet = new Set(this.getActiveProjectPaths())

    const results = await Promise.all(
      [...all.entries()].map(async ([path]) => {
        let isInitialized = false
        try {
          isInitialized = await this.contextTreeService.exists(path)
        } catch {
          // FS error — treat as not initialized
        }

        return {
          contextTreePath: join(path, BRV_DIR, CONTEXT_TREE_DIR),
          isActive: activeSet.has(path) || path === currentProjectPath,
          isCurrent: path === currentProjectPath,
          isInitialized,
          projectPath: path,
        }
      }),
    )

    // Sort: current first → active (has clients) → initialized → rest, all by registeredAt desc
    return results.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      if (a.isInitialized !== b.isInitialized) return a.isInitialized ? -1 : 1
      return (all.get(b.projectPath)?.registeredAt ?? 0) - (all.get(a.projectPath)?.registeredAt ?? 0)
    })
  }
}
