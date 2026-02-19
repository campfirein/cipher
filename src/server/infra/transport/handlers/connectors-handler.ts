import type {ConnectorDTO} from '../../../../shared/transport/types/dto.js'
import type {IConnectorManager} from '../../../core/interfaces/connectors/i-connector-manager.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  ConnectorEvents,
  type ConnectorGetAgentsResponse,
  type ConnectorInstallRequest,
  type ConnectorInstallResponse,
  type ConnectorListResponse,
} from '../../../../shared/transport/events/connector-events.js'
import {isConnectorType} from '../../../../shared/types/connector-type.js'
import {isAgent} from '../../../core/domain/entities/agent.js'
import {mapAgentsToDTOs} from './agent-dto-mapper.js'
import {type ProjectPathResolver, resolveRequiredProjectPath} from './handler-types.js'

export interface ConnectorsHandlerDeps {
  connectorManagerFactory: (projectRoot: string) => IConnectorManager
  resolveProjectPath: ProjectPathResolver
  transport: ITransportServer
}

/**
 * Handles connectors:* events.
 * Business logic for connector management — no terminal/UI calls.
 */
export class ConnectorsHandler {
  private readonly connectorManagerFactory: (projectRoot: string) => IConnectorManager
  private readonly resolveProjectPath: ProjectPathResolver
  private readonly transport: ITransportServer

  constructor(deps: ConnectorsHandlerDeps) {
    this.connectorManagerFactory = deps.connectorManagerFactory
    this.resolveProjectPath = deps.resolveProjectPath
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, ConnectorGetAgentsResponse>(ConnectorEvents.GET_AGENTS, () => this.handleGetAgents())

    this.transport.onRequest<void, ConnectorListResponse>(ConnectorEvents.LIST, (_data, clientId) =>
      this.handleList(clientId),
    )

    this.transport.onRequest<ConnectorInstallRequest, ConnectorInstallResponse>(
      ConnectorEvents.INSTALL,
      (data, clientId) => this.handleInstall(data, clientId),
    )
  }

  private handleGetAgents(): ConnectorGetAgentsResponse {
    return {agents: mapAgentsToDTOs()}
  }

  private async handleInstall(data: ConnectorInstallRequest, clientId: string): Promise<ConnectorInstallResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const connectorManager = this.connectorManagerFactory(projectPath)

    if (!isAgent(data.agentId)) {
      return {message: `Unsupported agent: ${data.agentId}`, success: false}
    }

    if (!isConnectorType(data.connectorType)) {
      return {message: `Unsupported connector type: ${data.connectorType}`, success: false}
    }

    const result = await connectorManager.switchConnector(data.agentId, data.connectorType)

    return {
      configPath: result.installResult.configPath,
      manualInstructions: result.installResult.manualInstructions,
      message: result.message,
      requiresManualSetup: result.installResult.requiresManualSetup,
      success: result.success,
    }
  }

  private async handleList(clientId: string): Promise<ConnectorListResponse> {
    const projectPath = resolveRequiredProjectPath(this.resolveProjectPath, clientId)
    const connectorManager = this.connectorManagerFactory(projectPath)

    const installedMap = await connectorManager.getAllInstalledConnectors()
    const connectors: ConnectorDTO[] = []

    for (const [agent, connectorType] of installedMap) {
      connectors.push({
        agent,
        connectorType,
        defaultType: connectorManager.getDefaultConnectorType(agent),
        supportedTypes: connectorManager.getSupportedConnectorTypes(agent),
      })
    }

    return {connectors}
  }

}
