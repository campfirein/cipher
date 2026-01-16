import type {Agent} from '../../domain/entities/agent.js'
import type {ConnectorType} from '../../domain/entities/connector-type.js'
import type {ConnectorInstallResult, ConnectorStatus, ConnectorSwitchResult} from './connector-types.js'
import type {IConnector} from './i-connector.js'

/**
 * Interface for managing connectors.
 * Acts as a factory for creating connectors and orchestrates connector operations.
 */
export interface IConnectorManager {
  /**
   * Get all installed connectors across all agents.
   * Iterates over all agents and checks which have connectors installed.
   *
   * @returns Map of agent to installed connector type (only includes agents with connectors)
   */
  getAllInstalledConnectors(): Promise<Map<Agent, ConnectorType>>

  /**
   * Get a connector instance for the specified type.
   *
   * @param type - The connector type
   * @returns The connector instance
   * @throws Error if the connector type is not supported
   */
  getConnector(type: ConnectorType): IConnector

  /**
   * Get the default connector type for the specified agent.
   *
   * @param agent - The agent to get the default connector for
   * @returns The default connector type
   */
  getDefaultConnectorType(agent: Agent): ConnectorType

  /**
   * Get the currently installed connector type for the specified agent.
   * Checks all connector types and returns the first one that is installed.
   *
   * @param agent - The agent to check
   * @returns The installed connector type, or null if none installed
   */
  getInstalledConnectorType(agent: Agent): Promise<ConnectorType | null>

  /**
   * Get list of connector types that support the specified agent.
   *
   * @param agent - The agent to check
   * @returns Array of supported connector types
   */
  getSupportedConnectorTypes(agent: Agent): ConnectorType[]

  /**
   * Install the default connector for the specified agent.
   *
   * @param agent - The agent to install for
   * @returns Installation result
   */
  installDefault(agent: Agent): Promise<ConnectorInstallResult>

  /**
   * Get the status of a specific connector type for an agent.
   *
   * @param type - The connector type
   * @param agent - The agent to check
   * @returns Connector status
   */
  status(type: ConnectorType, agent: Agent): Promise<ConnectorStatus>

  /**
   * Switch from one connector type to another for the specified agent.
   * Uninstalls the current connector (if any) and installs the new one.
   * This ensures only one connector is active per agent.
   *
   * @param agent - The agent to switch connectors for
   * @param toType - The connector type to switch to
   * @returns Switch result with details of uninstall and install operations
   */
  switchConnector(agent: Agent, toType: ConnectorType): Promise<ConnectorSwitchResult>
}
