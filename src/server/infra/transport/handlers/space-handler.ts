import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../../../core/interfaces/context-tree/i-context-tree-writer-service.js'
import type {ICogitPullService} from '../../../core/interfaces/services/i-cogit-pull-service.js'
import type {ISpaceService} from '../../../core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../core/interfaces/services/i-team-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {PullEvents} from '../../../../shared/transport/events/pull-events.js'
import {
  SpaceEvents,
  type SpaceListResponse,
  type SpaceSwitchPullResult,
  type SpaceSwitchRequest,
  type SpaceSwitchResponse,
} from '../../../../shared/transport/events/space-events.js'
import {
  LocalChangesExistError,
  NotAuthenticatedError,
  ProjectNotInitError,
  SpaceNotFoundError,
} from '../../../core/domain/errors/task-error.js'
import {syncConfigToXdg} from '../../../utils/config-xdg-sync.js'
import {type ProjectBroadcaster, type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface SpaceHandlerDeps {
  broadcastToProject: ProjectBroadcaster
  cogitPullService: ICogitPullService
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  contextTreeWriterService: IContextTreeWriterService
  projectConfigStore: IProjectConfigStore
  resolveProjectPath: ProjectPathResolver
  spaceService: ISpaceService
  teamService: ITeamService
  tokenStore: ITokenStore
  transport: ITransportServer
}

/**
 * Handles space:* events.
 * Business logic for space listing and switching — no terminal/UI calls.
 */
export class SpaceHandler {
  private readonly broadcastToProject: ProjectBroadcaster
  private readonly cogitPullService: ICogitPullService
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly contextTreeWriterService: IContextTreeWriterService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly spaceService: ISpaceService
  private readonly teamService: ITeamService
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: SpaceHandlerDeps) {
    this.broadcastToProject = deps.broadcastToProject
    this.cogitPullService = deps.cogitPullService
    this.contextTreeService = deps.contextTreeService
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.contextTreeWriterService = deps.contextTreeWriterService
    this.projectConfigStore = deps.projectConfigStore
    this.resolveProjectPath = deps.resolveProjectPath
    this.spaceService = deps.spaceService
    this.teamService = deps.teamService
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, SpaceListResponse>(SpaceEvents.LIST, (_data, clientId) => this.handleList(clientId))

    this.transport.onRequest<SpaceSwitchRequest, SpaceSwitchResponse>(SpaceEvents.SWITCH, (data, clientId) =>
      this.handleSwitch(data, clientId),
    )
  }

  private async handleList(clientId: string): Promise<SpaceListResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new NotAuthenticatedError()
    }

    const config = await this.projectConfigStore.read(projectPath)
    if (!config) {
      throw new ProjectNotInitError()
    }

    const {teams} = await this.teamService.getTeams(token.sessionKey, {fetchAll: true})

    const teamsWithSpaces = await Promise.all(
      teams.map(async (team) => {
        const {spaces} = await this.spaceService.getSpaces(token.sessionKey, team.id, {fetchAll: true})
        return {
          spaces: spaces.map((s) => ({
            id: s.id,
            isDefault: s.isDefault,
            name: s.name,
            teamId: s.teamId,
            teamName: s.teamName,
          })),
          teamId: team.id,
          teamName: team.name,
        }
      }),
    )

    return {teams: teamsWithSpaces}
  }

  private async handleSwitch(data: SpaceSwitchRequest, clientId: string): Promise<SpaceSwitchResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)

    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new NotAuthenticatedError()
    }

    const existingConfig = await this.projectConfigStore.read(projectPath)
    if (!existingConfig) {
      throw new ProjectNotInitError()
    }

    // Block switch if local context tree has unsaved changes
    const changes = await this.contextTreeSnapshotService.getChanges(projectPath)
    const hasLocalChanges = changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0
    if (hasLocalChanges) {
      throw new LocalChangesExistError()
    }

    // Find the target space across all teams
    const {teams} = await this.teamService.getTeams(token.sessionKey, {fetchAll: true})
    const allSpaces = await Promise.all(
      teams.map(async (team) => {
        const {spaces} = await this.spaceService.getSpaces(token.sessionKey, team.id, {fetchAll: true})
        return spaces
      }),
    )
    const targetSpace = allSpaces.flat().find((s) => s.id === data.spaceId)

    if (!targetSpace) {
      throw new SpaceNotFoundError()
    }

    const newConfig = existingConfig.withSpace(targetSpace)

    await this.projectConfigStore.write(newConfig, projectPath)
    await syncConfigToXdg(newConfig, projectPath)

    // Reset context tree and pull from the new space (non-fatal — switch succeeds even if pull fails)
    let pullResult: SpaceSwitchPullResult | undefined
    let pullError: string | undefined

    if (newConfig.spaceId && newConfig.teamId) {
      try {
        // Reset the old space's context tree before pulling
        this.broadcastToProject(projectPath, PullEvents.PROGRESS, {
          message: 'Resetting context tree...',
          step: 'resetting',
        })
        await this.contextTreeService.delete(projectPath)
        await this.contextTreeService.initialize(projectPath)
        await this.contextTreeSnapshotService.initEmptySnapshot(projectPath)

        this.broadcastToProject(projectPath, PullEvents.PROGRESS, {
          message: 'Pulling context from new space...',
          step: 'pulling',
        })

        const snapshot = await this.cogitPullService.pull({
          branch: 'main',
          sessionKey: token.sessionKey,
          spaceId: newConfig.spaceId,
          teamId: newConfig.teamId,
        })

        this.broadcastToProject(projectPath, PullEvents.PROGRESS, {message: 'Syncing files...', step: 'syncing'})

        const syncResult = await this.contextTreeWriterService.sync({directory: projectPath, files: snapshot.files})
        await this.contextTreeSnapshotService.saveSnapshot(projectPath)

        pullResult = {
          added: syncResult.added.length,
          commitSha: snapshot.commitSha,
          deleted: syncResult.deleted.length,
          edited: syncResult.edited.length,
        }
      } catch (error) {
        pullError = error instanceof Error ? error.message : String(error)
      }
    }

    return {
      config: {
        spaceId: newConfig.spaceId,
        spaceName: newConfig.spaceName,
        teamId: newConfig.teamId,
        teamName: newConfig.teamName,
        version: newConfig.version,
      },
      pullError,
      pullResult,
      success: true,
    }
  }
}
