import type {AgentDTO} from '../../../../shared/transport/types/dto.js'
import type {Agent} from '../../../core/domain/entities/agent.js'
import type {ConnectorType} from '../../../core/domain/entities/connector-type.js'
import type {ITokenStore} from '../../../core/interfaces/auth/i-token-store.js'
import type {IConnectorManager} from '../../../core/interfaces/connectors/i-connector-manager.js'
import type {IContextTreeService} from '../../../core/interfaces/context-tree/i-context-tree-service.js'
import type {IContextTreeSnapshotService} from '../../../core/interfaces/context-tree/i-context-tree-snapshot-service.js'
import type {IContextTreeWriterService} from '../../../core/interfaces/context-tree/i-context-tree-writer-service.js'
import type {ICogitPullService} from '../../../core/interfaces/services/i-cogit-pull-service.js'
import type {ISpaceService} from '../../../core/interfaces/services/i-space-service.js'
import type {ITeamService} from '../../../core/interfaces/services/i-team-service.js'
import type {ITrackingService} from '../../../core/interfaces/services/i-tracking-service.js'
import type {IProjectConfigStore} from '../../../core/interfaces/storage/i-project-config-store.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  InitEvents,
  type InitExecuteRequest,
  type InitExecuteResponse,
  type InitGetAgentsResponse,
  type InitGetSpacesRequest,
  type InitGetSpacesResponse,
  type InitGetTeamsResponse,
} from '../../../../shared/transport/events/init-events.js'
import {AGENT_CONNECTOR_CONFIG, AGENT_VALUES} from '../../../core/domain/entities/agent.js'
import {BrvConfig} from '../../../core/domain/entities/brv-config.js'
import {getErrorMessage} from '../../../utils/error-helpers.js'

export interface InitHandlerDeps {
  cogitPullService: ICogitPullService
  connectorManager: IConnectorManager
  contextTreeService: IContextTreeService
  contextTreeSnapshotService: IContextTreeSnapshotService
  contextTreeWriterService: IContextTreeWriterService
  projectConfigStore: IProjectConfigStore
  spaceService: ISpaceService
  teamService: ITeamService
  tokenStore: ITokenStore
  trackingService: ITrackingService
  transport: ITransportServer
}

/**
 * Handles init:* events.
 * Business logic for project initialization — no terminal/UI calls.
 * The TUI orchestrates the multi-step UX flow, calling granular events.
 */
export class InitHandler {
  private readonly cogitPullService: ICogitPullService
  private readonly connectorManager: IConnectorManager
  private readonly contextTreeService: IContextTreeService
  private readonly contextTreeSnapshotService: IContextTreeSnapshotService
  private readonly contextTreeWriterService: IContextTreeWriterService
  private readonly projectConfigStore: IProjectConfigStore
  private readonly spaceService: ISpaceService
  private readonly teamService: ITeamService
  private readonly tokenStore: ITokenStore
  private readonly trackingService: ITrackingService
  private readonly transport: ITransportServer

  constructor(deps: InitHandlerDeps) {
    this.cogitPullService = deps.cogitPullService
    this.connectorManager = deps.connectorManager
    this.contextTreeService = deps.contextTreeService
    this.contextTreeSnapshotService = deps.contextTreeSnapshotService
    this.contextTreeWriterService = deps.contextTreeWriterService
    this.projectConfigStore = deps.projectConfigStore
    this.spaceService = deps.spaceService
    this.teamService = deps.teamService
    this.tokenStore = deps.tokenStore
    this.trackingService = deps.trackingService
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, InitGetTeamsResponse>(InitEvents.GET_TEAMS, () => this.handleGetTeams())

    this.transport.onRequest<InitGetSpacesRequest, InitGetSpacesResponse>(InitEvents.GET_SPACES, (data) =>
      this.handleGetSpaces(data),
    )

    this.transport.onRequest<void, InitGetAgentsResponse>(InitEvents.GET_AGENTS, () => this.handleGetAgents())

    this.transport.onRequest<InitExecuteRequest, InitExecuteResponse>(InitEvents.EXECUTE, (data) =>
      this.handleExecute(data),
    )
  }

  private async handleExecute(data: InitExecuteRequest): Promise<InitExecuteResponse> {
    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new Error('Not authenticated')
    }

    await this.trackingService.track('space:init', {status: 'started'})

    // Check for existing config
    if ((await this.projectConfigStore.exists()) && !data.force) {
      throw new Error('Project already initialized. Use force to re-initialize.')
    }

    this.transport.broadcast(InitEvents.PROGRESS, {message: 'Fetching space...', step: 'fetch_space'})

    // Find space
    const {spaces} = await this.spaceService.getSpaces(token.sessionKey, data.teamId, {fetchAll: true})
    const space = spaces.find((s) => s.id === data.spaceId)
    if (!space) {
      throw new Error('Space not found')
    }

    this.transport.broadcast(InitEvents.PROGRESS, {message: 'Syncing from cloud...', step: 'sync'})

    // Pull from cloud
    try {
      const snapshot = await this.cogitPullService.pull({
        branch: 'main',
        sessionKey: token.sessionKey,
        spaceId: data.spaceId,
        teamId: data.teamId,
      })

      if (snapshot.files.length > 0) {
        await this.contextTreeWriterService.sync({files: snapshot.files})
        await this.contextTreeSnapshotService.saveSnapshot()
      } else {
        await this.contextTreeService.initialize()
        await this.contextTreeSnapshotService.initEmptySnapshot()
      }
    } catch {
      // If pull fails, initialize empty context tree
      await this.contextTreeService.initialize()
      await this.contextTreeSnapshotService.initEmptySnapshot()
    }

    this.transport.broadcast(InitEvents.PROGRESS, {message: 'Creating config...', step: 'config'})

    // Create and write config
    const agent = data.agentId as Agent
    const brvConfig = BrvConfig.fromSpace({
      chatLogPath: '',
      cwd: process.cwd(),
      ide: agent,
      space,
    })
    await this.projectConfigStore.write(brvConfig)

    this.transport.broadcast(InitEvents.PROGRESS, {message: 'Installing connector...', step: 'connector'})

    // Install connector
    try {
      const connectorType = data.connectorType as ConnectorType
      await this.connectorManager.switchConnector(agent, connectorType)
    } catch (error) {
      // Non-fatal: connector installation failure shouldn't block init
      this.transport.broadcast(InitEvents.PROGRESS, {
        message: `Connector warning: ${getErrorMessage(error)}`,
        step: 'connector_warning',
      })
    }

    await this.trackingService.track('space:init', {spaceId: data.spaceId, status: 'finished', teamId: data.teamId})

    this.transport.broadcast(InitEvents.COMPLETED, {
      config: {spaceName: brvConfig.spaceName, teamName: brvConfig.teamName},
      success: true,
    })

    return {success: true}
  }

  private handleGetAgents(): InitGetAgentsResponse {
    const agents: AgentDTO[] = AGENT_VALUES.map((agentName) => {
      const config = AGENT_CONNECTOR_CONFIG[agentName]
      return {
        defaultConnectorType: config.default,
        id: agentName,
        name: agentName,
        supportedConnectorTypes: [...config.supported],
      }
    })

    return {agents}
  }

  private async handleGetSpaces(data: InitGetSpacesRequest): Promise<InitGetSpacesResponse> {
    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new Error('Not authenticated')
    }

    const {spaces} = await this.spaceService.getSpaces(token.sessionKey, data.teamId, {fetchAll: true})

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

  private async handleGetTeams(): Promise<InitGetTeamsResponse> {
    const token = await this.tokenStore.load()
    if (!token || !token.isValid()) {
      throw new Error('Not authenticated')
    }

    const {teams} = await this.teamService.getTeams(token.sessionKey, {fetchAll: true})

    return {
      teams: teams.map((t) => ({
        displayName: t.displayName,
        id: t.id,
        isDefault: t.isDefault,
        name: t.name,
      })),
    }
  }
}
