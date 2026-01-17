import path from 'node:path'

import type {Agent} from '../../../core/domain/entities/agent.js'
import type {ConnectorType} from '../../../core/domain/entities/connector-type.js'
import type {
  ConnectorInstallResult,
  ConnectorStatus,
  ConnectorUninstallResult,
} from '../../../core/interfaces/connectors/connector-types.js'
import type {IConnector} from '../../../core/interfaces/connectors/i-connector.js'
import type {IFileService} from '../../../core/interfaces/i-file-service.js'

import {AGENT_CONNECTOR_CONFIG} from '../../../core/domain/entities/agent.js'
import {isRecord} from '../../../utils/type-guards.js'
import {HOOK_CONNECTOR_CONFIGS, type HookConnectorConfig, type HookSupportedAgent} from './hook-connector-config.js'

/**
 * Options for constructing HookConnector.
 */
type HookConnectorOptions = {
  fileService: IFileService
  projectRoot: string
}

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
 * Connector that integrates BRV with coding agents via hooks.
 * Manages hook configurations stored in JSON files.
 *
 * Key safety features:
 * - Non-destructive: Preserves user's existing hooks
 * - No duplicates: Checks before adding new hooks
 * - Safe uninstall: Only removes ByteRover hooks by command match
 */
export class HookConnector implements IConnector {
  readonly type: ConnectorType = 'hook' as const
  private readonly fileService: IFileService
  private readonly projectRoot: string
  private readonly supportedAgents: Agent[]

  constructor(options: HookConnectorOptions) {
    this.fileService = options.fileService
    this.projectRoot = options.projectRoot
    this.supportedAgents = Object.entries(AGENT_CONNECTOR_CONFIG)
      .filter(([_, config]) => config.supported.includes(this.type))
      .map(([agent]) => agent as Agent)
  }

  getConfigPath(agent: Agent): string {
    if (!this.isSupported(agent)) {
      throw new Error(`Hook connector does not support agent: ${agent}`)
    }

    return HOOK_CONNECTOR_CONFIGS[agent].configPath
  }

  getSupportedAgents(): Agent[] {
    return this.supportedAgents
  }

  async install(agent: Agent): Promise<ConnectorInstallResult> {
    if (!this.isSupported(agent)) {
      return {
        alreadyInstalled: false,
        configPath: '',
        message: `Hook connector does not support agent: ${agent}`,
        success: false,
      }
    }

    const config: HookConnectorConfig = HOOK_CONNECTOR_CONFIGS[agent]
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
            message: `Hook connector is already installed for ${agent}`,
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
          message: `Hook connector installed for ${agent}`,
          success: true,
        }
      }

      // File doesn't exist - create new config
      const newConfig: Record<string, unknown> = config.defaultConfig ? structuredClone(config.defaultConfig) : {}

      this.setHooksArray(newConfig, config.hookEventKey, [config.createHookEntry()])

      await this.fileService.write(JSON.stringify(newConfig, null, 2), fullPath, 'overwrite')

      return {
        alreadyInstalled: false,
        configPath: config.configPath,
        message: `Hook connector installed for ${agent} (created ${config.configPath})`,
        success: true,
      }
    } catch (error) {
      return {
        alreadyInstalled: false,
        configPath: config.configPath,
        message: `Failed to install hook connector for ${agent}: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      }
    }
  }

  isSupported(agent: Agent): agent is HookSupportedAgent {
    return AGENT_CONNECTOR_CONFIG[agent].supported.includes(this.type)
  }

  async status(agent: Agent): Promise<ConnectorStatus> {
    if (!this.isSupported(agent)) {
      return {
        configExists: false,
        configPath: '',
        error: `Hook connector does not support agent: ${agent}`,
        installed: false,
      }
    }

    const config = HOOK_CONNECTOR_CONFIGS[agent]
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
    } catch (error) {
      return {
        configExists: true,
        configPath: config.configPath,
        error: error instanceof Error ? error.message : String(error),
        installed: false,
      }
    }
  }

  async uninstall(agent: Agent): Promise<ConnectorUninstallResult> {
    if (!this.isSupported(agent)) {
      return {
        configPath: '',
        message: `Hook connector does not support agent: ${agent}`,
        success: false,
        wasInstalled: false,
      }
    }

    const config = HOOK_CONNECTOR_CONFIGS[agent]
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
          message: `Hook connector is not installed for ${agent}`,
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
        message: `Hook connector uninstalled for ${agent}`,
        success: true,
        wasInstalled: true,
      }
    } catch (error) {
      return {
        configPath: config.configPath,
        message: `Failed to uninstall hook connector for ${agent}: ${error instanceof Error ? error.message : String(error)}`,
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
      config.hooks = {[eventKey]: hooks}
      return
    }

    config.hooks[eventKey] = hooks
  }
}
