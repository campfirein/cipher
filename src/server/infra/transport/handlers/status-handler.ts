import type {StatusDTO} from '../../../../shared/transport/types/dto.js'
import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {ITrackingService} from '../../../core/interfaces/services/i-tracking-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {StatusEvents, type StatusGetResponse} from '../../../../shared/transport/events/status-events.js'

export interface StatusHandlerDeps {
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  projectConfigStore: IProjectConfigStore
  tokenStore: ITokenStore
  trackingService: ITrackingService
  transport: ITransportServer
}

/**
 * Handles status:get event.
 * Collects auth, project, and context tree status — pure data, no terminal output.
 */
export class StatusHandler {
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService
  private readonly transport: ITransportServer

  constructor(deps: StatusHandlerDeps) {
    this.contextTreeService = deps.contextTreeService
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.projectConfigStore = deps.projectConfigStore
    this.tokenStore = deps.tokenStore
    this.trackingService = deps.trackingService
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, StatusGetResponse>(StatusEvents.GET, async () => {
      const status = await this.collectStatus()
      await this.trackingService.track('mem:status')
      return {status}
    })
  }

  private async collectStatus(): Promise<StatusDTO> {
    const result: StatusDTO = {
      authStatus: 'unknown',
      contextTreeStatus: 'unknown',
      currentDirectory: process.cwd(),
      projectInitialized: false,
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
      const isInitialized = await this.projectConfigStore.exists()
      result.projectInitialized = isInitialized
      if (isInitialized) {
        const config = await this.projectConfigStore.read()
        if (config) {
          result.teamName = config.teamName
          result.spaceName = config.spaceName
        }
      }
    } catch {
      result.projectInitialized = false
    }

    // Context tree status
    try {
      const contextTreeExists = await this.contextTreeService.exists()
      if (contextTreeExists) {
        const hasSnapshot = await this.contextTreeSnapshotService.hasSnapshot()
        if (!hasSnapshot) {
          await this.contextTreeSnapshotService.initEmptySnapshot()
        }

        const changes = await this.contextTreeSnapshotService.getChanges()
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

    return result
  }
}
