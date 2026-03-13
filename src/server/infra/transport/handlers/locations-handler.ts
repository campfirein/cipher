import {readdir} from 'node:fs/promises'
import {join} from 'node:path'

import type {ProjectLocationDTO} from '../../../../shared/transport/types/dto.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IProjectRegistry} from '../../../core/interfaces/project/i-project-registry.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {LocationsEvents, type LocationsGetResponse} from '../../../../shared/transport/events/locations-events.js'
import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../constants.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface LocationsHandlerDeps {
  contextTreeService: IContextTreeService
  getActiveProjectPaths: () => string[]
  listContextTreeEntries?: (ctDir: string) => Promise<{domainCount: number; fileCount: number}>
  projectRegistry: IProjectRegistry
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

/**
 * Handles locations:get event.
 * Returns all registered project locations with context tree status and counts.
 */
export class LocationsHandler {
  private readonly contextTreeService: IContextTreeService
  private readonly getActiveProjectPaths: () => string[]
  private readonly listContextTreeEntries: (ctDir: string) => Promise<{domainCount: number; fileCount: number}>
  private readonly projectRegistry: IProjectRegistry
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: LocationsHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.getActiveProjectPaths = deps.getActiveProjectPaths
    this.listContextTreeEntries = deps.listContextTreeEntries ?? LocationsHandler.defaultListContextTreeEntries
    this.projectRegistry = deps.projectRegistry
    this.resolveProjectPath = deps.resolveProjectPath
    this.transport = deps.transport
  }

  private static async defaultListContextTreeEntries(ctDir: string): Promise<{domainCount: number; fileCount: number}> {
    // Non-recursive read for immediate subdirectories (domains) — avoids Dirent.parentPath (Node 20.12+ only)
    const topLevel = await readdir(ctDir, {withFileTypes: true})
    const domainCount = topLevel.filter((e) => e.isDirectory()).length

    // Recursive read for all .md files
    const allEntries = await readdir(ctDir, {recursive: true, withFileTypes: true})
    const fileCount = allEntries.filter((e) => e.isFile() && e.name.endsWith('.md')).length
    return {domainCount, fileCount}
  }

  setup(): void {
    this.transport.onRequest<void, LocationsGetResponse>(LocationsEvents.GET, async (_data, clientId) => {
      const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
      try {
        const locations = await this.buildLocations(projectPath)
        return {locations}
      } catch {
        return {locations: []}
      }
    })
  }

  private async buildLocations(currentProjectPath: string): Promise<ProjectLocationDTO[]> {
    const all = this.projectRegistry.getAll()
    const activeSet = new Set(this.getActiveProjectPaths())

    const results = await Promise.all(
      [...all.entries()].map(async ([path]) => {
        const ctDir = join(path, BRV_DIR, CONTEXT_TREE_DIR)
        let isInitialized = false
        try {
          isInitialized = await this.contextTreeService.exists(path)
        } catch (error) {
          console.error('LocationsHandler: failed to check context tree existence', error)
          // FS error — treat as not initialized
        }

        let domainCount = 0
        let fileCount = 0

        if (isInitialized) {
          try {
            const counts = await this.listContextTreeEntries(ctDir)
            domainCount = counts.domainCount
            fileCount = counts.fileCount
          } catch (error) {
            console.error('LocationsHandler: failed to list context tree entries', error)
            // ENOENT or permission error — leave counts at 0
          }
        }

        return {
          domainCount,
          fileCount,
          isActive: activeSet.has(path) && path !== currentProjectPath,
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
