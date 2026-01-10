import {
  type HookInstallResult,
  type HookStatus,
  type HookSupportedAgent,
  type HookUninstallResult,
} from '../hooks/i-hook-manager.js'

/**
 * UseCase interface for managing coding agent hooks.
 * This abstraction allows TUI REPL and other components to manage hooks
 * without knowing the implementation details.
 */
export interface IHookManageUseCase {
  /**
   * Get list of supported agents for hook management.
   */
  getSupportedAgents(): HookSupportedAgent[]

  /**
   * Install ByteRover hook for the specified agent.
   * @param agent - The coding agent to install the hook for
   */
  install(agent: HookSupportedAgent): Promise<HookInstallResult>

  /**
   * Check installation status of ByteRover hook for the specified agent.
   * @param agent - The coding agent to check status for
   */
  status(agent: HookSupportedAgent): Promise<HookStatus>

  /**
   * Uninstall ByteRover hook for the specified agent.
   * @param agent - The coding agent to uninstall the hook from
   */
  uninstall(agent: HookSupportedAgent): Promise<HookUninstallResult>
}
