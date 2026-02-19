import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {ISpaceService} from '../../../core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../core/interfaces/services/i-team-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  SpaceEvents,
  type SpaceListResponse,
  type SpaceSwitchRequest,
  type SpaceSwitchResponse,
} from '../../../../shared/transport/events/space-events.js'
import {NotAuthenticatedError, ProjectNotInitError, SpaceNotFoundError} from '../../../core/domain/errors/task-error.js'
import {syncConfigToXdg} from '../../../utils/config-xdg-sync.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface SpaceHandlerDeps {
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
  private readonly projectConfigStore: IProjectConfigStore
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly spaceService: ISpaceService
  private readonly teamService: ITeamService
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: SpaceHandlerDeps) {
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

    return {
      config: {
        spaceId: newConfig.spaceId,
        spaceName: newConfig.spaceName,
        teamId: newConfig.teamId,
        teamName: newConfig.teamName,
        version: newConfig.version,
      },
      success: true,
    }
  }
}
