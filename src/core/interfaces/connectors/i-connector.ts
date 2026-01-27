import type {Agent} from '../../domain/entities/agent.js'
import type {ConnectorType} from '../../domain/entities/connector-type.js'
import type {ConnectorInstallResult, ConnectorStatus, ConnectorUninstallResult} from './connector-types.js'

/**
 * Interface for a connector that integrates BRV with a coding agent.
 * Each connector type (rules, hook, mcp) has its own implementation.
 */
export interface IConnector {
  /** The type of this connector */
  readonly connectorType: ConnectorType

  /**
   * Get the path to the configuration/rule file for a specific agent.
   *
   * @param agent - The agent to get the config path for
   * @returns The path relative to project root
   */
  getConfigPath(agent: Agent): string

  /**
   * Get list of agents supported by this connector type.
   *
   * @returns Array of supported agent names
   */
  getSupportedAgents(): Agent[]

  /**
   * Install the connector for the specified agent.
   * If already installed, returns alreadyInstalled: true.
   *
   * @param agent - The coding agent to install for
   * @returns Installation result with success status and message
   */
  install(agent: Agent): Promise<ConnectorInstallResult>

  /**
   * Check if this connector supports the specified agent.
   *
   * @param agent - The agent to check
   * @returns True if the agent is supported
   */
  isSupported(agent: Agent): boolean

  /**
   * Check the installation status for the specified agent.
   *
   * @param agent - The coding agent to check status for
   * @returns Status including installed state and config file existence
   */
  status(agent: Agent): Promise<ConnectorStatus>

  /**
   * Uninstall the connector for the specified agent.
   * Only removes BRV content, preserves user's other configurations.
   *
   * @param agent - The coding agent to uninstall from
   * @returns Uninstallation result with success status and message
   */
  uninstall(agent: Agent): Promise<ConnectorUninstallResult>
}
