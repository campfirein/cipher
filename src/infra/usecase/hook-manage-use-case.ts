import {
  type HookInstallResult,
  type HookStatus,
  type HookSupportedAgent,
  type HookUninstallResult,
  type IHookManager,
} from '../../core/interfaces/hooks/i-hook-manager.js'
import {type IHookManageUseCase} from '../../core/interfaces/usecase/i-hook-manage-use-case.js'

/**
 * Options for constructing HookManageUseCase.
 */
export type HookManageUseCaseOptions = {
  hookManager: IHookManager
}

/**
 * UseCase implementation for managing coding agent hooks.
 * Delegates to IHookManager for actual operations.
 *
 * This layer exists to:
 * 1. Provide a consistent interface for TUI REPL
 * 2. Allow for future enhancements (logging, tracking, etc.)
 * 3. Follow the established UseCase pattern in the codebase
 */
export class HookManageUseCase implements IHookManageUseCase {
  private readonly hookManager: IHookManager

  constructor(options: HookManageUseCaseOptions) {
    this.hookManager = options.hookManager
  }

  getSupportedAgents(): HookSupportedAgent[] {
    return this.hookManager.getSupportedAgents()
  }

  async install(agent: HookSupportedAgent): Promise<HookInstallResult> {
    return this.hookManager.install(agent)
  }

  async status(agent: HookSupportedAgent): Promise<HookStatus> {
    return this.hookManager.status(agent)
  }

  async uninstall(agent: HookSupportedAgent): Promise<HookUninstallResult> {
    return this.hookManager.uninstall(agent)
  }
}
