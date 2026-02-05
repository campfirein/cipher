import type {Agent} from '../../domain/entities/agent.js'
import type {ConnectorType} from '../../domain/entities/connector-type.js'
import type {ConnectorInstallResult, ConnectorStatus, ConnectorUninstallResult} from './connector-types.js'

/**
 * Options for connector operations that may need to bypass support checks.
 */
export type ConnectorOperationOptions = {
  /** When true, bypasses the isSupported() check. Used for migration of orphaned connectors. */
  force?: boolean
}

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
   * @param options - Optional settings; use { force: true } to bypass isSupported() check
   * @returns Status including installed state and config file existence
   */
  status(agent: Agent, options?: ConnectorOperationOptions): Promise<ConnectorStatus>

  /**
   * Uninstall the connector for the specified agent.
   * Only removes BRV content, preserves user's other configurations.
   *
   * @param agent - The coding agent to uninstall from
   * @param options - Optional settings; use { force: true } to bypass isSupported() check
   * @returns Uninstallation result with success status and message
   */
  uninstall(agent: Agent, options?: ConnectorOperationOptions): Promise<ConnectorUninstallResult>
}
