import type {HookSupportedAgent} from '../../domain/entities/agent.js'

/**
 * Result of a hook installation operation.
 */
export type HookInstallResult = {
  /** Whether the hook was already installed (no action taken) */
  alreadyInstalled: boolean
  /** Path to the configuration file */
  configPath: string
  /** Human-readable message describing the result */
  message: string
  /** Whether the installation was successful */
  success: boolean
}

/**
 * Result of a hook uninstallation operation.
 */
export type HookUninstallResult = {
  /** Path to the configuration file */
  configPath: string
  /** Human-readable message describing the result */
  message: string
  /** Whether the uninstallation was successful */
  success: boolean
  /** Whether the hook was installed before uninstall */
  wasInstalled: boolean
}

/**
 * Status of a hook installation.
 */
export type HookStatus = {
  /** Whether the configuration file exists */
  configExists: boolean
  /** Path to the configuration file */
  configPath: string
  /** Error message if status check failed (e.g., permission denied, malformed JSON) */
  error?: string
  /** Whether the ByteRover hook is currently installed */
  installed: boolean
}

/**
 * Interface for managing coding agent hooks.
 * Provides install, uninstall, and status operations for ByteRover hooks.
 *
 * Key safety features:
 * - Non-destructive: Never deletes user's other hooks
 * - No duplicates: Checks before adding
 * - Safe uninstall: Only removes ByteRover hooks
 */
export interface IHookManager {
  /**
   * Get list of supported agents for hook management.
   *
   * @returns Array of supported agent names
   */
  getSupportedAgents(): HookSupportedAgent[]

  /**
   * Install ByteRover hook for the specified agent.
   * If the hook is already installed, returns alreadyInstalled: true.
   * Preserves any existing hooks configured by the user.
   *
   * @param agent - The coding agent to install the hook for
   * @returns Installation result with success status and message
   */
  install(agent: HookSupportedAgent): Promise<HookInstallResult>

  /**
   * Check the installation status of ByteRover hook for the specified agent.
   *
   * @param agent - The coding agent to check status for
   * @returns Status including installed state and config file existence
   */
  status(agent: HookSupportedAgent): Promise<HookStatus>

  /**
   * Uninstall ByteRover hook for the specified agent.
   * Only removes ByteRover hooks, preserves user's other hooks.
   * If the hook is not installed, returns wasInstalled: false.
   *
   * @param agent - The coding agent to uninstall the hook from
   * @returns Uninstallation result with success status and message
   */
  uninstall(agent: HookSupportedAgent): Promise<HookUninstallResult>
}
