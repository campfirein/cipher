import type {Agent} from '../../domain/entities/agent.js'
import type {ConnectorType} from '../../domain/entities/connector-type.js'

/**
 * Instructions for manual MCP setup when automatic configuration is not possible.
 */
export type ManualInstallInstructions = {
  /** The config content to copy (JSON or TOML formatted) */
  configContent: string
  /** Guide URL or step-by-step instructions */
  guide: string
}

/**
 * Result of a connector installation operation.
 */
export type ConnectorInstallResult = {
  /** Whether the connector was already installed (no action taken) */
  alreadyInstalled: boolean
  /** Path to the configuration/rule file */
  configPath: string
  /** Instructions for manual setup (present when requiresManualSetup is true) */
  manualInstructions?: ManualInstallInstructions
  /** Human-readable message describing the result */
  message: string
  /** Whether this requires manual setup by the user */
  requiresManualSetup?: boolean
  /** Whether the installation was successful */
  success: boolean
}

/**
 * Result of a connector uninstallation operation.
 */
export type ConnectorUninstallResult = {
  /** Path to the configuration/rule file */
  configPath: string
  /** Human-readable message describing the result */
  message: string
  /** Whether the uninstallation was successful */
  success: boolean
  /** Whether the connector was installed before uninstall */
  wasInstalled: boolean
}

/**
 * Status of a connector installation.
 */
export type ConnectorStatus = {
  /** Whether the configuration/rule file exists */
  configExists: boolean
  /** Path to the configuration/rule file */
  configPath: string
  /** Error message if status check failed */
  error?: string
  /** Whether the connector is currently installed */
  installed: boolean
}

/**
 * Result of migrating an orphaned connector for an agent
 * that no longer supports the connector type.
 */
export type OrphanedConnectorMigrationResult = {
  /** The agent that had an orphaned connector */
  agent: Agent
  /** Path to the configuration that was cleaned up */
  configPath: string
  /** Whether the cleanup was successful */
  success: boolean
}

/**
 * Result of switching from one connector type to another.
 */
export type ConnectorSwitchResult = {
  /** The connector type that was uninstalled (if any) */
  fromType: ConnectorType | null
  /** Result of the installation operation */
  installResult: ConnectorInstallResult
  /** Human-readable message describing the result */
  message: string
  /** Whether the switch was successful */
  success: boolean
  /** The connector type that was installed */
  toType: ConnectorType
  /** Result of the uninstallation operation (if switching) */
  uninstallResult?: ConnectorUninstallResult
}
