import {join} from 'node:path'

import type {StatusDTO} from '../../../../shared/transport/types/dto.js'
import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ICurateLogStore} from '../../../core/interfaces/storage/i-curate-log-store.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {StatusEvents, type StatusGetResponse} from '../../../../shared/transport/events/status-events.js'
import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../constants.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

/** Factory that creates a curate log store scoped to a project directory. */
export type CurateLogStoreFactory = (projectPath: string) => ICurateLogStore

export interface StatusHandlerDeps {
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  curateLogStoreFactory: CurateLogStoreFactory
  projectConfigStore: IProjectConfigStore
  resolveProjectPath: ProjectPathResolver
  tokenStore: ITokenStore
  transport: ITransportServer
}

/**
 * Handles status:get event.
 * Collects auth, project, and context tree status — pure data, no terminal output.
 */
export class StatusHandler {
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly curateLogStoreFactory: CurateLogStoreFactory
  private readonly projectConfigStore: IProjectConfigStore
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: StatusHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.curateLogStoreFactory = deps.curateLogStoreFactory
    this.projectConfigStore = deps.projectConfigStore
    this.resolveProjectPath = deps.resolveProjectPath
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, StatusGetResponse>(StatusEvents.GET, async (_data, clientId) => {
      const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
      const status = await this.collectStatus(projectPath)
      return {status}
    })
  }

  private async collectStatus(projectPath: string): Promise<StatusDTO> {
    const result: StatusDTO = {
      authStatus: 'unknown',
      contextTreeStatus: 'unknown',
      currentDirectory: projectPath,
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
    try {
      const contextTreeExists = await this.contextTreeService.exists(projectPath)
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

    // Pending review count (best-effort)
    try {
      const store = this.curateLogStoreFactory(projectPath)
      const entries = await store.list({limit: 100, status: ['completed']})
      const pendingFiles = new Set<string>()
      const contextTreeRoot = join(projectPath, BRV_DIR, CONTEXT_TREE_DIR)

      for (const entry of entries) {
        for (const op of entry.operations) {
          if (op.reviewStatus === 'pending' && op.filePath) {
            const prefix = contextTreeRoot + '/'
            const relativePath = op.filePath.startsWith(prefix) ? op.filePath.slice(prefix.length) : op.filePath
            pendingFiles.add(relativePath)
          }
        }
      }

      if (pendingFiles.size > 0) {
        result.pendingReviewCount = pendingFiles.size
        const port = this.transport.getPort()
        if (port) {
          const encoded = Buffer.from(projectPath).toString('base64url')
          result.reviewUrl = `http://127.0.0.1:${port}/review?project=${encoded}`
        }
      }
    } catch {
      // Best-effort — if the log is unavailable, skip review info
    }

    return result
  }
}
