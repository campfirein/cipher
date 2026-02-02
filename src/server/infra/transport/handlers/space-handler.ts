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
import {BrvConfig} from '../../../core/domain/entities/brv-config.js'

export interface SpaceHandlerDeps {
  projectConfigStore: IProjectConfigStore
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
  private readonly spaceService: ISpaceService
  private readonly teamService: ITeamService
  private readonly tokenStore: ITokenStore
  private readonly transport: ITransportServer

  constructor(deps: SpaceHandlerDeps) {
    this.projectConfigStore = deps.projectConfigStore
    this.spaceService = deps.spaceService
    this.teamService = deps.teamService
    this.tokenStore = deps.tokenStore
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, SpaceListResponse>(SpaceEvents.LIST, () => this.handleList())

    this.transport.onRequest<SpaceSwitchRequest, SpaceSwitchResponse>(SpaceEvents.SWITCH, (data) =>
      this.handleSwitch(data),
    )
  }

  private async handleList(): Promise<SpaceListResponse> {
    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new Error('Not authenticated')
    }

    const config = await this.projectConfigStore.read()
    if (!config) {
      throw new Error('Project not initialized')
    }

    const {spaces} = await this.spaceService.getSpaces(token.sessionKey, config.teamId, {fetchAll: true})

    return {
      spaces: spaces.map((s) => ({
        id: s.id,
        isDefault: s.isDefault,
        name: s.name,
        teamId: s.teamId,
        teamName: s.teamName,
      })),
    }
  }

  private async handleSwitch(data: SpaceSwitchRequest): Promise<SpaceSwitchResponse> {
    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new Error('Not authenticated')
    }

    const existingConfig = await this.projectConfigStore.read()
    if (!existingConfig) {
      throw new Error('Project not initialized')
    }

    // Find the target space
    const {spaces} = await this.spaceService.getSpaces(token.sessionKey, existingConfig.teamId, {fetchAll: true})
    const targetSpace = spaces.find((s) => s.id === data.spaceId)
    if (!targetSpace) {
      throw new Error('Space not found')
    }

    // Create updated config preserving existing fields
    const newConfig = new BrvConfig({
      chatLogPath: existingConfig.chatLogPath,
      cipherAgentContext: existingConfig.cipherAgentContext,
      cipherAgentModes: existingConfig.cipherAgentModes,
      cipherAgentSystemPrompt: existingConfig.cipherAgentSystemPrompt,
      createdAt: new Date().toISOString(),
      cwd: existingConfig.cwd,
      ide: existingConfig.ide,
      spaceId: targetSpace.id,
      spaceName: targetSpace.name,
      teamId: targetSpace.teamId,
      teamName: targetSpace.teamName,
      version: existingConfig.version,
    })

    await this.projectConfigStore.write(newConfig)

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
