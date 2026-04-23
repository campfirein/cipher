import {spawn} from 'node:child_process'
import {join} from 'node:path'

import type {ProjectLocationDTO} from '../../../../shared/transport/types/dto.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IProjectRegistry} from '../../../core/interfaces/project/i-project-registry.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  LocationsEvents,
  type LocationsGetResponse,
  type LocationsRevealRequest,
  type LocationsRevealResponse,
} from '../../../../shared/transport/events/locations-events.js'
import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../constants.js'
import {type ProjectPathResolver} from './handler-types.js'
import {resolveRevealCommand} from './reveal-command.js'

export interface LocationsHandlerDeps {
  contextTreeService: IContextTreeService
  getActiveProjectPaths: () => string[]
  pathExists: (path: string) => Promise<boolean>
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
  private readonly pathExists: (path: string) => Promise<boolean>
  private readonly projectRegistry: IProjectRegistry
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: LocationsHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.getActiveProjectPaths = deps.getActiveProjectPaths
    this.pathExists = deps.pathExists
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

    this.transport.onRequest<LocationsRevealRequest, LocationsRevealResponse>(
      LocationsEvents.REVEAL,
      async (data) => this.handleReveal(data),
    )
  }

  private async buildLocations(currentProjectPath?: string): Promise<ProjectLocationDTO[]> {
    const all = this.projectRegistry.getAll()
    const activeSet = new Set(this.getActiveProjectPaths())

    const results = await Promise.all(
      [...all.entries()].map(async ([path]) => {
        try {
          const exists = await this.pathExists(path)
          if (!exists) {
            this.projectRegistry.unregister(path)
            return null
          }
        } catch {
          // pathExists threw unexpectedly — skip this entry but do NOT unregister,
          // since the path may still exist (e.g. a transient permission error).
          return null
        }

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

    const filtered = results.filter((r): r is ProjectLocationDTO => r !== null)

    // Sort: current first → active (has clients) → initialized → rest, all by registeredAt desc
    return filtered.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      if (a.isInitialized !== b.isInitialized) return a.isInitialized ? -1 : 1
      return (all.get(b.projectPath)?.registeredAt ?? 0) - (all.get(a.projectPath)?.registeredAt ?? 0)
    })
  }

  private async handleReveal(data: LocationsRevealRequest): Promise<LocationsRevealResponse> {
    const {projectPath} = data
    if (!projectPath) throw new Error('projectPath is required')

    // Only allow revealing paths that are registered projects — the client
    // controls this argument, so we must not trust it blindly.
    const registered = this.projectRegistry.getAll()
    if (!registered.has(projectPath)) {
      throw new Error('Project is not registered.')
    }

    const exists = await this.pathExists(projectPath).catch(() => false)
    if (!exists) throw new Error('Project folder no longer exists.')

    const {args, command} = resolveRevealCommand(process.platform, projectPath)
    const child = spawn(command, args, {detached: true, stdio: 'ignore'})
    child.on('error', () => {
      /* best-effort — nothing to report back once the ack resolved */
    })
    child.unref()

    return {projectPath}
  }
}
