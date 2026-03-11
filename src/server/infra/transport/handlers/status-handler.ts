import {readdir} from 'node:fs/promises'
import {join} from 'node:path'

import type {ProjectLocationDTO, StatusDTO} from '../../../../shared/transport/types/dto.js'
import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IProjectRegistry} from '../../../core/interfaces/project/i-project-registry.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {StatusEvents, type StatusGetResponse} from '../../../../shared/transport/events/status-events.js'
import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../constants.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface StatusHandlerDeps {
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  getActiveProjectPaths: () => string[]
  listContextTreeEntries?: (ctDir: string) => Promise<{domainCount: number; fileCount: number}>
  projectConfigStore: IProjectConfigStore
  projectRegistry: IProjectRegistry
  resolveProjectPath: ProjectPathResolver
  tokenStore: ITokenStore
  transport: ITransportServer
}

/**
 * Handles status:get event.
 * Collects auth, project, context tree, and registered locations — pure data, no terminal output.
 */
export class StatusHandler {
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly getActiveProjectPaths: () => string[]
  private readonly listContextTreeEntries: (ctDir: string) => Promise<{domainCount: number; fileCount: number}>
  private readonly projectConfigStore: IProjectConfigStore
  private readonly projectRegistry: IProjectRegistry
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: StatusHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.getActiveProjectPaths = deps.getActiveProjectPaths
    this.listContextTreeEntries = deps.listContextTreeEntries ?? StatusHandler.defaultListContextTreeEntries
    this.projectConfigStore = deps.projectConfigStore
    this.projectRegistry = deps.projectRegistry
    this.resolveProjectPath = deps.resolveProjectPath
    this.tokenStore = deps.tokenStore
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
    this.transport.onRequest<void, StatusGetResponse>(StatusEvents.GET, async (_data, clientId) => {
      const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
      const status = await this.collectStatus(projectPath)
      return {status}
    })
  }

  private async buildLocations(currentProjectPath: string, currentCtExists?: boolean): Promise<ProjectLocationDTO[]> {
    const all = this.projectRegistry.getAll()
    const activeSet = new Set(this.getActiveProjectPaths())

    const results = await Promise.all(
      [...all.entries()].map(async ([path, info]) => {
        const ctDir = join(path, BRV_DIR, CONTEXT_TREE_DIR)
        let isInitialized = false
        try {
          isInitialized =
            path === currentProjectPath && currentCtExists !== undefined
              ? currentCtExists
              : await this.contextTreeService.exists(path)
        } catch {
          // FS error — treat as not initialized
        }

        let domainCount = 0
        let fileCount = 0

        if (isInitialized) {
          try {
            const counts = await this.listContextTreeEntries(ctDir)
            domainCount = counts.domainCount
            fileCount = counts.fileCount
          } catch {
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
          registeredAt: info.registeredAt,
        }
      }),
    )

    // Sort: current first → active (has clients) → initialized → rest, all by registeredAt desc
    return results
      .sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        if (a.isInitialized !== b.isInitialized) return a.isInitialized ? -1 : 1
        return b.registeredAt - a.registeredAt
      })
      .map(({registeredAt: _, ...dto}) => dto)
  }

  private async collectStatus(projectPath: string): Promise<StatusDTO> {
    const result: StatusDTO = {
      authStatus: 'unknown',
      contextTreeStatus: 'unknown',
      currentDirectory: projectPath,
      locations: [],
    }

    // Auth status
    try {
      const token = await this.tokenStore.load()
      if (token !== undefined && token.isValid()) {
        result.authStatus = 'logged_in'
        result.userEmail = token.userEmail
      } else if (token === undefined) {
        result.authStatus = 'not_logged_in'
      } else {
        result.authStatus = 'expired'
      }
    } catch {
      result.authStatus = 'unknown'
    }

    // Project status
    try {
      const isInitialized = await this.projectConfigStore.exists(projectPath)
      if (isInitialized) {
        const config = await this.projectConfigStore.read(projectPath)
        if (config) {
          result.teamName = config.teamName
          result.spaceName = config.spaceName
        }
      }
    } catch {}

    // Context tree status
    let contextTreeExists: boolean | undefined
    try {
      contextTreeExists = await this.contextTreeService.exists(projectPath)
      if (contextTreeExists) {
        result.contextTreeDir = join(projectPath, BRV_DIR, CONTEXT_TREE_DIR)
        result.contextTreeRelativeDir = join(BRV_DIR, CONTEXT_TREE_DIR)

        const hasSnapshot = await this.contextTreeSnapshotService.hasSnapshot(projectPath)
        if (!hasSnapshot) {
          await this.contextTreeSnapshotService.initEmptySnapshot(projectPath)
        }

        const changes = await this.contextTreeSnapshotService.getChanges(projectPath)
        const hasChanges = changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0

        if (hasChanges) {
          result.contextTreeStatus = 'has_changes'
          result.contextTreeChanges = {
            added: changes.added,
            deleted: changes.deleted,
            modified: changes.modified,
          }
        } else {
          result.contextTreeStatus = 'no_changes'
        }
      } else {
        result.contextTreeStatus = 'not_initialized'
      }
    } catch {
      result.contextTreeStatus = 'unknown'
    }

    // Registered project locations
    try {
      result.locations = await this.buildLocations(projectPath, contextTreeExists)
    } catch {
      result.locations = []
    }

    return result
  }
}
