import type {Agent} from '../../core/domain/entities/agent.js'
import type {ConnectorType} from '../../core/domain/entities/connector-type.js'
import type {
  ConnectorInstallResult,
  ConnectorStatus,
  ConnectorSwitchResult,
} from '../../core/interfaces/connectors/connector-types.js'
import type {IConnectorManager} from '../../core/interfaces/connectors/i-connector-manager.js'
import type {IConnector} from '../../core/interfaces/connectors/i-connector.js'
import type {IFileService} from '../../core/interfaces/i-file-service.js'
import type {IRuleTemplateService} from '../../core/interfaces/i-rule-template-service.js'

import {AGENT_CONNECTOR_CONFIG, AGENT_VALUES} from '../../core/domain/entities/agent.js'
import {CONNECTOR_TYPES} from '../../core/domain/entities/connector-type.js'
import {HookConnector} from './hook/hook-connector.js'
import {RulesConnector} from './rules/rules-connector.js'

/**
 * Options for constructing ConnectorManager.
 */
type ConnectorManagerOptions = {
  fileService: IFileService
  projectRoot: string
  templateService: IRuleTemplateService
}

/**
 * Factory and orchestration layer for connectors.
 * Creates connector instances and manages connector operations.
 */
export class ConnectorManager implements IConnectorManager {
  private readonly connectors: Map<ConnectorType, IConnector>

  constructor(options: ConnectorManagerOptions) {
    const {fileService, projectRoot, templateService} = options

    // Create connector instances
    this.connectors = new Map<ConnectorType, IConnector>([
      ['hook', new HookConnector({fileService, projectRoot})],
      ['rules', new RulesConnector({fileService, projectRoot, templateService})],
    ])
  }

  async getAllInstalledConnectors(): Promise<Map<Agent, ConnectorType>> {
    const installed = new Map<Agent, ConnectorType>()

    // Check all agents in parallel
    const results = await Promise.all(
      AGENT_VALUES.map(async (agent) => {
        const connectorType = await this.getInstalledConnectorType(agent)
        return {agent, connectorType}
      }),
    )

    // Add only agents with installed connectors to the map
    for (const {agent, connectorType} of results) {
      if (connectorType) {
        installed.set(agent, connectorType)
      }
    }

    return installed
  }

  getConnector(type: ConnectorType): IConnector {
    const connector = this.connectors.get(type)
    if (!connector) {
      throw new Error(`Unknown connector type: ${type}`)
    }

    return connector
  }

  getDefaultConnectorType(agent: Agent): ConnectorType {
    return AGENT_CONNECTOR_CONFIG[agent].default
  }

  async getInstalledConnectorType(agent: Agent): Promise<ConnectorType | null> {
    // Check each connector type to see if it's installed
    // We need to check sequentially to return the first installed connector
    const checkResults = await Promise.all(
      CONNECTOR_TYPES.map(async (type) => {
        const connector = this.connectors.get(type)
        if (connector && connector.isSupported(agent)) {
          const status = await connector.status(agent)
          return status.installed ? type : null
        }

        return null
      }),
    )

    return checkResults.find((type) => type !== null) ?? null
  }

  getSupportedConnectorTypes(agent: Agent): ConnectorType[] {
    const supported: ConnectorType[] = []

    for (const type of CONNECTOR_TYPES) {
      const connector = this.connectors.get(type)
      if (connector && connector.isSupported(agent)) {
        supported.push(type)
      }
    }

    return supported
  }

  async installDefault(agent: Agent): Promise<ConnectorInstallResult> {
    const defaultType = this.getDefaultConnectorType(agent)
    const connector = this.getConnector(defaultType)
    return connector.install(agent)
  }

  async status(type: ConnectorType, agent: Agent): Promise<ConnectorStatus> {
    const connector = this.getConnector(type)
    return connector.status(agent)
  }

  async switchConnector(agent: Agent, toType: ConnectorType): Promise<ConnectorSwitchResult> {
    const toConnector = this.getConnector(toType)

    if (!toConnector.isSupported(agent)) {
      return {
        fromType: null,
        installResult: {
          alreadyInstalled: false,
          configPath: '',
          message: `Connector type '${toType}' does not support agent: ${agent}`,
          success: false,
        },
        message: `Connector type '${toType}' does not support agent: ${agent}`,
        success: false,
        toType,
      }
    }

    // Check if any connector is currently installed
    const currentType = await this.getInstalledConnectorType(agent)

    // If switching to the same type, just return success
    if (currentType === toType) {
      const status = await toConnector.status(agent)
      return {
        fromType: currentType,
        installResult: {
          alreadyInstalled: true,
          configPath: status.configPath,
          message: `${toType} connector is already installed for ${agent}`,
          success: true,
        },
        message: `${toType} connector is already installed for ${agent}`,
        success: true,
        toType,
      }
    }

    // Uninstall current connector if one exists
    let uninstallResult
    if (currentType) {
      const currentConnector = this.getConnector(currentType)
      uninstallResult = await currentConnector.uninstall(agent)

      if (!uninstallResult.success) {
        return {
          fromType: currentType,
          installResult: {
            alreadyInstalled: false,
            configPath: '',
            message: 'Installation skipped due to uninstall failure',
            success: false,
          },
          message: `Failed to uninstall ${currentType} connector: ${uninstallResult.message}`,
          success: false,
          toType,
          uninstallResult,
        }
      }
    }

    // Install new connector
    const installResult = await toConnector.install(agent)

    if (!installResult.success) {
      return {
        fromType: currentType,
        installResult,
        message: `Failed to install ${toType} connector: ${installResult.message}`,
        success: false,
        toType,
        uninstallResult,
      }
    }

    // Build success message
    const message = currentType
      ? `Switched ${agent} from ${currentType} to ${toType}`
      : `Installed ${toType} connector for ${agent}`

    return {
      fromType: currentType,
      installResult,
      message,
      success: true,
      toType,
      uninstallResult,
    }
  }
}
