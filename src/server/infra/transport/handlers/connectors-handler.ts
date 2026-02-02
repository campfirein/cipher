import type {AgentDTO, ConnectorDTO} from '../../../../shared/transport/types/dto.js'
import type {ConnectorType} from '../../../core/domain/entities/connector-type.js'
import type {IConnectorManager} from '../../../core/interfaces/connectors/i-connector-manager.js'
import type {ITrackingService} from '../../../core/interfaces/services/i-tracking-service.js'
import type {ITransportServer} from '../../../core/interfaces/transport/i-transport-server.js'

import {
  ConnectorEvents,
  type ConnectorGetAgentsResponse,
  type ConnectorInstallRequest,
  type ConnectorInstallResponse,
  type ConnectorListResponse,
} from '../../../../shared/transport/events/connector-events.js'
import {type Agent, AGENT_CONNECTOR_CONFIG, AGENT_VALUES} from '../../../core/domain/entities/agent.js'

export interface ConnectorsHandlerDeps {
  connectorManager: IConnectorManager
  trackingService: ITrackingService
  transport: ITransportServer
}

/**
 * Handles connectors:* events.
 * Business logic for connector management — no terminal/UI calls.
 */
export class ConnectorsHandler {
  private readonly connectorManager: IConnectorManager
  private readonly trackingService: ITrackingService
  private readonly transport: ITransportServer

  constructor(deps: ConnectorsHandlerDeps) {
    this.connectorManager = deps.connectorManager
    this.trackingService = deps.trackingService
    this.transport = deps.transport
  }

  setup(): void {
    this.transport.onRequest<void, ConnectorGetAgentsResponse>(ConnectorEvents.GET_AGENTS, () => this.handleGetAgents())

    this.transport.onRequest<void, ConnectorListResponse>(ConnectorEvents.LIST, () => this.handleList())

    this.transport.onRequest<ConnectorInstallRequest, ConnectorInstallResponse>(ConnectorEvents.INSTALL, (data) =>
      this.handleInstall(data),
    )
  }

  private handleGetAgents(): ConnectorGetAgentsResponse {
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

  private async handleInstall(data: ConnectorInstallRequest): Promise<ConnectorInstallResponse> {
    const agent = data.agentId as Agent
    const connectorType = data.connectorType as ConnectorType

    const result = await this.connectorManager.switchConnector(agent, connectorType)

    await this.trackingService.track('connector:switch', {
      agent: data.agentId,
      fromType: result.fromType ?? 'none',
      success: result.success,
      toType: data.connectorType,
    })

    return {
      configPath: result.installResult.configPath,
      manualInstructions: result.installResult.manualInstructions,
      message: result.message,
      requiresManualSetup: result.installResult.requiresManualSetup,
      success: result.success,
    }
  }

  private async handleList(): Promise<ConnectorListResponse> {
    await this.trackingService.track('connector:list')

    const installedMap = await this.connectorManager.getAllInstalledConnectors()
    const connectors: ConnectorDTO[] = []

    for (const [agent, connectorType] of installedMap) {
      connectors.push({
        agent,
        connectorType,
        defaultType: this.connectorManager.getDefaultConnectorType(agent),
        supportedTypes: this.connectorManager.getSupportedConnectorTypes(agent),
      })
    }

    return {connectors}
  }
}
