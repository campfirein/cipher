import path from 'node:path'

import {
  type HookInstallResult,
  type HookStatus,
  type HookSupportedAgent,
  type HookUninstallResult,
  type IHookManager,
} from '../../core/interfaces/hooks/i-hook-manager.js'
import {type IFileService} from '../../core/interfaces/i-file-service.js'
import {isRecord} from '../../utils/type-guards.js'
import {AGENT_HOOK_CONFIGS, HOOK_SUPPORTED_AGENTS} from './agent-hook-configs.js'

/**
 * Parse JSON and validate it's a Record object.
 * @throws Error if JSON is invalid or not an object
 */
function parseJsonAsRecord(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content)
  if (!isRecord(parsed)) {
    throw new Error('Expected JSON object')
  }

  return parsed
}

/**
 * File-based implementation of IHookManager.
 * Manages hook configurations stored in JSON files for various coding agents.
 *
 * Key safety features:
 * - Non-destructive: Preserves user's existing hooks
 * - No duplicates: Checks before adding new hooks
 * - Safe uninstall: Only removes ByteRover hooks by command match
 */
export class FileHookManager implements IHookManager {
  constructor(
    private readonly fileService: IFileService,
    private readonly projectRoot: string = process.cwd(),
  ) {}

  getSupportedAgents(): HookSupportedAgent[] {
    return [...HOOK_SUPPORTED_AGENTS]
  }

  async install(agent: HookSupportedAgent): Promise<HookInstallResult> {
    const config = AGENT_HOOK_CONFIGS[agent]
    const fullPath = path.join(this.projectRoot, config.configPath)

    try {
      const exists = await this.fileService.exists(fullPath)

      if (exists) {
        // Read existing config
        const content = await this.fileService.read(fullPath)
        const json = parseJsonAsRecord(content)

        // Check if our hook already exists
        const hooks = this.getHooksArray(json, config.hookEventKey)
        const alreadyInstalled = hooks.some((entry) => config.isOurHook(entry))

        if (alreadyInstalled) {
          return {
            alreadyInstalled: true,
            configPath: config.configPath,
            message: `ByteRover hook is already installed for ${agent}`,
            success: true,
          }
        }

        // Add our hook to the array (preserve existing hooks)
        const newEntry = config.createHookEntry()
        this.setHooksArray(json, config.hookEventKey, [...hooks, newEntry])

        // Write back
        await this.fileService.write(JSON.stringify(json, null, 2), fullPath, 'overwrite')

        return {
          alreadyInstalled: false,
          configPath: config.configPath,
          message: `ByteRover hook installed for ${agent}`,
          success: true,
        }
      }

      // File doesn't exist - create new config
      // Use deep copy to avoid mutating the shared defaultConfig object
      const newConfig: Record<string, unknown> = config.defaultConfig
        ? structuredClone(config.defaultConfig)
        : {}

      this.setHooksArray(newConfig, config.hookEventKey, [config.createHookEntry()])

      await this.fileService.write(JSON.stringify(newConfig, null, 2), fullPath, 'overwrite')

      return {
        alreadyInstalled: false,
        configPath: config.configPath,
        message: `ByteRover hook installed for ${agent} (created ${config.configPath})`,
        success: true,
      }
    } catch (error) {
      return {
        alreadyInstalled: false,
        configPath: config.configPath,
        message: `Failed to install hook for ${agent}: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      }
    }
  }

  async status(agent: HookSupportedAgent): Promise<HookStatus> {
    const config = AGENT_HOOK_CONFIGS[agent]
    const fullPath = path.join(this.projectRoot, config.configPath)

    try {
      const exists = await this.fileService.exists(fullPath)

      if (!exists) {
        return {
          configExists: false,
          configPath: config.configPath,
          installed: false,
        }
      }

      // Read and check for our hook
      const content = await this.fileService.read(fullPath)
      const json = parseJsonAsRecord(content)
      const hooks = this.getHooksArray(json, config.hookEventKey)
      const installed = hooks.some((entry) => config.isOurHook(entry))

      return {
        configExists: true,
        configPath: config.configPath,
        installed,
      }
    } catch {
      // If we can't read/parse the file, report as not installed
      return {
        configExists: true,
        configPath: config.configPath,
        installed: false,
      }
    }
  }

  async uninstall(agent: HookSupportedAgent): Promise<HookUninstallResult> {
    const config = AGENT_HOOK_CONFIGS[agent]
    const fullPath = path.join(this.projectRoot, config.configPath)
    let wasInstalled = false

    try {
      const exists = await this.fileService.exists(fullPath)

      if (!exists) {
        return {
          configPath: config.configPath,
          message: `Config file does not exist: ${config.configPath}`,
          success: true,
          wasInstalled: false,
        }
      }

      // Read existing config
      const content = await this.fileService.read(fullPath)
      const json = parseJsonAsRecord(content)

      // Get current hooks and filter out ours
      const hooks = this.getHooksArray(json, config.hookEventKey)
      wasInstalled = hooks.some((entry) => config.isOurHook(entry))

      if (!wasInstalled) {
        return {
          configPath: config.configPath,
          message: `ByteRover hook is not installed for ${agent}`,
          success: true,
          wasInstalled: false,
        }
      }

      // Remove only our hooks (preserve others)
      const filteredHooks = hooks.filter((entry) => !config.isOurHook(entry))
      this.setHooksArray(json, config.hookEventKey, filteredHooks)

      // Write back (even if array is empty - don't delete file)
      await this.fileService.write(JSON.stringify(json, null, 2), fullPath, 'overwrite')

      return {
        configPath: config.configPath,
        message: `ByteRover hook uninstalled for ${agent}`,
        success: true,
        wasInstalled: true,
      }
    } catch (error) {
      return {
        configPath: config.configPath,
        message: `Failed to uninstall hook for ${agent}: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
        wasInstalled,
      }
    }
  }

  /**
   * Get the hooks array from the config for a specific event key.
   * Handles the nested structure: config.hooks[eventKey]
   */
  private getHooksArray(config: Record<string, unknown>, eventKey: string): unknown[] {
    if (!isRecord(config.hooks)) {
      return []
    }

    const eventHooks = config.hooks[eventKey]
    if (!Array.isArray(eventHooks)) {
      return []
    }

    return eventHooks
  }

  /**
   * Set the hooks array in the config for a specific event key.
   * Creates the nested structure if it doesn't exist.
   */
  private setHooksArray(config: Record<string, unknown>, eventKey: string, hooks: unknown[]): void {
    if (!isRecord(config.hooks)) {
      // Create hooks object with the event key
      config.hooks = {[eventKey]: hooks}
      return
    }

    // TypeScript now knows config.hooks is a Record
    config.hooks[eventKey] = hooks
  }
}
