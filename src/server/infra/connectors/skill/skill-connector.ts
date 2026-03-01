import os from 'node:os'
import path from 'node:path'

import type {Agent} from '../../../core/domain/entities/agent.js'
import type {ConnectorType} from '../../../core/domain/entities/connector-type.js'
import type {
  ConnectorInstallResult,
  ConnectorStatus,
  ConnectorUninstallResult,
} from '../../../core/interfaces/connectors/connector-types.js'
import type {ConnectorOperationOptions, IConnector} from '../../../core/interfaces/connectors/i-connector.js'
import type {IFileService} from '../../../core/interfaces/services/i-file-service.js'
import type {SkillConnectorConfig, SkillSupportedAgent} from './skill-connector-config.js'

import {AGENT_CONNECTOR_CONFIG} from '../../../core/domain/entities/agent.js'
import {
  BRV_SKILL_NAME,
  MAIN_SKILL_FILE_NAME,
  SKILL_CONNECTOR_CONFIGS,
  SKILL_FILE_NAMES,
} from './skill-connector-config.js'
import {SkillContentLoader} from './skill-content-loader.js'

/**
 * Options for constructing SkillConnector.
 */
type SkillConnectorOptions = {
  fileService: IFileService
  projectRoot: string
}

/**
 * Options for writeSkillFiles, allowing scope override.
 */
export type WriteSkillFilesOptions = {
  scope?: 'global' | 'project'
}

/**
 * Connector that integrates BRV with coding agents via skill files.
 * Writes static markdown files (SKILL.md)
 * into an agent-specific subdirectory.
 */
export class SkillConnector implements IConnector {
  readonly connectorType: ConnectorType = 'skill'
  private readonly contentLoader: SkillContentLoader
  private readonly fileService: IFileService
  private readonly projectRoot: string
  private readonly supportedAgents: Agent[]

  constructor(options: SkillConnectorOptions) {
    this.fileService = options.fileService
    this.projectRoot = options.projectRoot
    this.contentLoader = new SkillContentLoader(options.fileService)
    this.supportedAgents = Object.entries(AGENT_CONNECTOR_CONFIG)
      .filter(([_, config]) => config.supported.includes(this.connectorType))
      .map(([agent]) => agent as Agent)
  }

  getConfigPath(agent: Agent): string {
    if (!this.isSupported(agent)) {
      throw new Error(`Skill connector does not support agent: ${agent}`)
    }

    const config = this.getConfig(agent)
    const basePath = config.projectPath || config.globalPath
    if (!basePath) {
      throw new Error(`Skill connector has no configured path for agent: ${agent}`)
    }

    return path.join(basePath, BRV_SKILL_NAME)
  }

  getSupportedAgents(): Agent[] {
    return this.supportedAgents
  }

  async install(agent: Agent): Promise<ConnectorInstallResult> {
    if (!this.isSupported(agent)) {
      return {
        alreadyInstalled: false,
        configPath: '',
        message: `Skill connector does not support agent: ${agent}`,
        success: false,
      }
    }

    const config = this.getConfig(agent)

    // Install the skill connector in the project directory by default
    if (!config.projectPath && !config.globalPath) {
      return {
        alreadyInstalled: false,
        configPath: '',
        message: `Skill connector has no configured path for agent: ${agent}`,
        success: false,
      }
    }

    // Install to project directory by default, fall back to global for global-only agents
    const scope = config.projectPath ? 'project' : 'global'
    const fullDir = this.resolveFullPath(config, scope, BRV_SKILL_NAME)

    try {
      const skillFilePath = path.join(fullDir, MAIN_SKILL_FILE_NAME)
      if (await this.fileService.exists(skillFilePath)) {
        return {
          alreadyInstalled: true,
          configPath: fullDir,
          message: `Skill connector is already installed for ${agent}`,
          success: true,
        }
      }

      await Promise.all(
        SKILL_FILE_NAMES.map(async (fileName) => {
          const content = await this.contentLoader.loadSkillFile(fileName)
          const filePath = path.join(fullDir, fileName)
          await this.fileService.write(content, filePath, 'overwrite')
        }),
      )

      return {
        alreadyInstalled: false,
        configPath: fullDir,
        message: `Skill connector installed for ${agent} (created ${fullDir}/)`,
        success: true,
      }
    } catch (error) {
      return {
        alreadyInstalled: false,
        configPath: fullDir,
        message: `Failed to install skill connector for ${agent}: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      }
    }
  }

  isSupported(agent: Agent): agent is SkillSupportedAgent {
    return agent in SKILL_CONNECTOR_CONFIGS && AGENT_CONNECTOR_CONFIG[agent].supported.includes(this.connectorType)
  }

  async status(agent: Agent, options?: ConnectorOperationOptions): Promise<ConnectorStatus> {
    if (!options?.force && !this.isSupported(agent)) {
      return {
        configExists: false,
        configPath: '',
        error: `Skill connector does not support agent: ${agent}`,
        installed: false,
      }
    }

    if (!(agent in SKILL_CONNECTOR_CONFIGS)) {
      return {
        configExists: false,
        configPath: '',
        installed: false,
      }
    }

    const config = this.getConfig(agent)

    try {
      // Check project scope first
      if (config.projectPath) {
        const projectDir = this.resolveFullPath(config, 'project', BRV_SKILL_NAME)
        const projectSkillFile = path.join(projectDir, SKILL_FILE_NAMES[0])
        if (await this.fileService.exists(projectSkillFile)) {
          return {
            configExists: true,
            configPath: path.join(config.projectPath, BRV_SKILL_NAME),
            installed: true,
          }
        }
      }

      // Check global scope
      if (config.globalPath) {
        const globalDir = this.resolveFullPath(config, 'global', BRV_SKILL_NAME)
        const globalSkillFile = path.join(globalDir, SKILL_FILE_NAMES[0])
        if (await this.fileService.exists(globalSkillFile)) {
          return {
            configExists: true,
            configPath: path.join(config.globalPath, BRV_SKILL_NAME),
            installed: true,
          }
        }
      }

      return {
        configExists: false,
        configPath: '',
        installed: false,
      }
    } catch (error) {
      return {
        configExists: false,
        configPath: '',
        error: error instanceof Error ? error.message : String(error),
        installed: false,
      }
    }
  }

  async uninstall(agent: Agent, options?: ConnectorOperationOptions): Promise<ConnectorUninstallResult> {
    if (!options?.force && !this.isSupported(agent)) {
      return {
        configPath: '',
        message: `Skill connector does not support agent: ${agent}`,
        success: false,
        wasInstalled: false,
      }
    }

    if (!(agent in SKILL_CONNECTOR_CONFIGS)) {
      return {
        configPath: '',
        message: `Skill connector has no config for agent: ${agent}`,
        success: true,
        wasInstalled: false,
      }
    }

    const config = this.getConfig(agent)

    try {
      // Try to uninstall from project scope
      if (config.projectPath) {
        const projectDir = this.resolveFullPath(config, 'project', BRV_SKILL_NAME)
        const projectSkillFile = path.join(projectDir, SKILL_FILE_NAMES[0])
        if (await this.fileService.exists(projectSkillFile)) {
          await this.fileService.deleteDirectory(projectDir)
          return {
            configPath: path.join(config.projectPath, BRV_SKILL_NAME),
            message: `Skill connector uninstalled for ${agent}`,
            success: true,
            wasInstalled: true,
          }
        }
      }

      // Try to uninstall from global scope
      if (config.globalPath) {
        const globalDir = this.resolveFullPath(config, 'global', BRV_SKILL_NAME)
        const globalSkillFile = path.join(globalDir, SKILL_FILE_NAMES[0])
        if (await this.fileService.exists(globalSkillFile)) {
          await this.fileService.deleteDirectory(globalDir)
          return {
            configPath: path.join(config.globalPath, BRV_SKILL_NAME),
            message: `Skill connector uninstalled for ${agent}`,
            success: true,
            wasInstalled: true,
          }
        }
      }

      return {
        configPath: '',
        message: `Skill connector is not installed for ${agent}`,
        success: true,
        wasInstalled: false,
      }
    } catch (error) {
      return {
        configPath: '',
        message: `Failed to uninstall skill connector for ${agent}: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
        wasInstalled: true,
      }
    }
  }

  /**
   * Write files to a named skill subdirectory for the given agent.
   * Used by hub install to write downloaded skill files to e.g. `.claude/skills/{skillName}/`.
   *
   * @param agent - Agent connector target
   * @param skillName - Skill folder name to create under the connector path
   * @param files - Skill files to write
   * @param options - Optional install scope
   * @param options.scope - 'global' writes to home dir, 'project' (default) writes to project root
   */
  async writeSkillFiles(
    agent: Agent,
    skillName: string,
    files: Array<{content: string; name: string}>,
    options?: WriteSkillFilesOptions,
  ): Promise<{alreadyInstalled: boolean; installedFiles: string[]; installedPath: string}> {
    if (!this.isSupported(agent)) {
      throw new Error(`Skill connector does not support agent: ${agent}`)
    }

    const scope = options?.scope ?? 'project'
    const config = this.getConfig(agent)
    const basePath = scope === 'global' ? config.globalPath : config.projectPath
    if (!basePath) {
      throw new Error(`Skill connector does not support ${scope} scope for agent: ${agent}`)
    }

    const fullDir = this.resolveFullPath(config, scope, skillName)

    if (files.length > 0) {
      const firstFilePath = path.join(fullDir, files[0].name)
      if (await this.fileService.exists(firstFilePath)) {
        return {alreadyInstalled: true, installedFiles: [], installedPath: fullDir}
      }
    }

    const installedFiles: string[] = []
    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(fullDir, file.name)
        await this.fileService.write(file.content, filePath, 'overwrite')
        installedFiles.push(filePath)
      }),
    )

    return {alreadyInstalled: false, installedFiles, installedPath: fullDir}
  }

  /**
   * Get the skill connector config for an agent, typed as SkillConnectorConfig
   * to allow safe optional property access on union types from `as const`.
   */
  private getConfig(agent: Agent): SkillConnectorConfig {
    return SKILL_CONNECTOR_CONFIGS[agent as SkillSupportedAgent]
  }

  /**
   * Get the full (absolute) path for skill file operations.
   * Combines the config base path with the skill name, rooted at either
   * the project root (project scope) or the user's home directory (global scope).
   *
   * @throws Error if the requested scope is not configured for the agent.
   */
  private resolveFullPath(config: SkillConnectorConfig, scope: 'global' | 'project', skillName: string): string {
    if (scope === 'global') {
      if (!config.globalPath) {
        throw new Error('Global path is not configured for this agent')
      }

      return path.join(os.homedir(), config.globalPath, skillName)
    }

    if (!config.projectPath) {
      throw new Error('Project path is not configured for this agent')
    }

    return path.join(this.projectRoot, config.projectPath, skillName)
  }
}
