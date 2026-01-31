import type {Agent} from '../../core/domain/entities/agent.js'
import type {ConnectorType} from '../../core/domain/entities/connector-type.js'
import type {
  ConnectorInstallResult,
  ConnectorStatus,
  ConnectorSwitchResult,
  OrphanedConnectorMigrationResult,
} from '../../core/interfaces/connectors/connector-types.js'
import type {IConnectorManager} from '../../core/interfaces/connectors/i-connector-manager.js'
import type {IConnector} from '../../core/interfaces/connectors/i-connector.js'
import type {IFileService} from '../../core/interfaces/services/i-file-service.js'
import type {IRuleTemplateService} from '../../core/interfaces/services/i-rule-template-service.js'

import {AGENT_CONNECTOR_CONFIG, AGENT_VALUES} from '../../core/domain/entities/agent.js'
import {CONNECTOR_TYPES} from '../../core/domain/entities/connector-type.js'
import {HOOK_CONNECTOR_CONFIGS} from './hook/hook-connector-config.js'
import {HookConnector} from './hook/hook-connector.js'
import {MCP_CONNECTOR_CONFIGS} from './mcp/mcp-connector-config.js'
import {McpConnector} from './mcp/mcp-connector.js'
import {RULES_CONNECTOR_CONFIGS} from './rules/rules-connector-config.js'
import {RulesConnector} from './rules/rules-connector.js'
import {SKILL_CONNECTOR_CONFIGS} from './skill/skill-connector-config.js'
import {SkillConnector} from './skill/skill-connector.js'

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
      ['mcp', new McpConnector({fileService, projectRoot, templateService})],
      ['rules', new RulesConnector({fileService, projectRoot, templateService})],
      ['skill', new SkillConnector({fileService, projectRoot})],
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

  async migrateOrphanedConnectors(): Promise<OrphanedConnectorMigrationResult[]> {
    // Step 1: Collect orphaned agent/connector pairs. Each connector config map
    // (e.g., MCP_CONNECTOR_CONFIGS) defines which agents have configs for that type.
    // An agent is orphaned when it exists in the config map but the connector type
    // is no longer in AGENT_CONNECTOR_CONFIG[agent].supported.
    const connectorConfigAgents: Array<{agents: Agent[]; type: ConnectorType}> = [
      {agents: Object.keys(HOOK_CONNECTOR_CONFIGS) as Agent[], type: 'hook'},
      {agents: Object.keys(MCP_CONNECTOR_CONFIGS) as Agent[], type: 'mcp'},
      {agents: Object.keys(RULES_CONNECTOR_CONFIGS) as Agent[], type: 'rules'},
      {agents: Object.keys(SKILL_CONNECTOR_CONFIGS) as Agent[], type: 'skill'},
    ]

    const orphanedPairs: Array<{agent: Agent; connector: IConnector}> = []

    for (const {agents, type} of connectorConfigAgents) {
      const connector = this.connectors.get(type)
      if (!connector) continue

      for (const agent of agents) {
        if (!AGENT_CONNECTOR_CONFIG[agent].supported.includes(type)) {
          orphanedPairs.push({agent, connector})
        }
      }
    }

    // Step 2: Check each candidate in parallel. Use { force: true } to bypass
    // the isSupported() guard, since these connectors are no longer in the
    // agent's supported list but may still have configs on disk from when
    // they were previously supported.
    const results = await Promise.all(
      orphanedPairs.map(async ({agent, connector}) => {
        const status = await connector.status(agent, {force: true})
        if (!status.installed) return null

        const uninstallResult = await connector.uninstall(agent, {force: true})
        return {
          agent,
          configPath: uninstallResult.configPath,
          success: uninstallResult.success,
        }
      }),
    )

    return results.filter((result) => result !== null)
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
