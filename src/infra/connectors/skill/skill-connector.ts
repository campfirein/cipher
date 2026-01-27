import os from 'node:os'
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
import type {SkillSupportedAgent} from './skill-connector-config.js'

import {AGENT_CONNECTOR_CONFIG} from '../../../core/domain/entities/agent.js'
import {SKILL_CONNECTOR_CONFIGS, SKILL_FILE_NAMES} from './skill-connector-config.js'
import {SkillContentLoader} from './skill-content-loader.js'

/**
 * Options for constructing SkillConnector.
 */
type SkillConnectorOptions = {
  fileService: IFileService
  projectRoot: string
}

/**
 * Connector that integrates BRV with coding agents via skill files.
 * Writes static markdown files (SKILL.md, TROUBLESHOOTING.md, WORKFLOWS.md)
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

    return SKILL_CONNECTOR_CONFIGS[agent as SkillSupportedAgent].basePath
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

    const config = SKILL_CONNECTOR_CONFIGS[agent as SkillSupportedAgent]
    const fullDir = this.getFullPath(config.basePath, config.scope)

    try {
      // Check if already installed
      const skillFilePath = path.join(fullDir, SKILL_FILE_NAMES[0])
      if (await this.fileService.exists(skillFilePath)) {
        return {
          alreadyInstalled: true,
          configPath: config.basePath,
          message: `Skill connector is already installed for ${agent}`,
          success: true,
        }
      }

      // Write all skill files
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
        configPath: config.basePath,
        message: `Failed to install skill connector for ${agent}: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      }
    }
  }

  isSupported(agent: Agent): agent is SkillSupportedAgent {
    return agent in SKILL_CONNECTOR_CONFIGS && AGENT_CONNECTOR_CONFIG[agent].supported.includes(this.connectorType)
  }

  async status(agent: Agent): Promise<ConnectorStatus> {
    if (!this.isSupported(agent)) {
      return {
        configExists: false,
        configPath: '',
        error: `Skill connector does not support agent: ${agent}`,
        installed: false,
      }
    }

    const config = SKILL_CONNECTOR_CONFIGS[agent as SkillSupportedAgent]
    const fullDir = this.getFullPath(config.basePath, config.scope)

    try {
      const skillFilePath = path.join(fullDir, SKILL_FILE_NAMES[0])
      const exists = await this.fileService.exists(skillFilePath)

      return {
        configExists: exists,
        configPath: config.basePath,
        installed: exists,
      }
    } catch (error) {
      return {
        configExists: false,
        configPath: config.basePath,
        error: error instanceof Error ? error.message : String(error),
        installed: false,
      }
    }
  }

  async uninstall(agent: Agent): Promise<ConnectorUninstallResult> {
    if (!this.isSupported(agent)) {
      return {
        configPath: '',
        message: `Skill connector does not support agent: ${agent}`,
        success: false,
        wasInstalled: false,
      }
    }

    const config = SKILL_CONNECTOR_CONFIGS[agent as SkillSupportedAgent]
    const fullDir = this.getFullPath(config.basePath, config.scope)

    try {
      const skillFilePath = path.join(fullDir, SKILL_FILE_NAMES[0])
      const exists = await this.fileService.exists(skillFilePath)

      if (!exists) {
        return {
          configPath: config.basePath,
          message: `Skill connector is not installed for ${agent}`,
          success: true,
          wasInstalled: false,
        }
      }

      await this.fileService.deleteDirectory(fullDir)

      return {
        configPath: config.basePath,
        message: `Skill connector uninstalled for ${agent}`,
        success: true,
        wasInstalled: true,
      }
    } catch (error) {
      return {
        configPath: config.basePath,
        message: `Failed to uninstall skill connector for ${agent}: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
        wasInstalled: true,
      }
    }
  }

  /**
   * Get the full (absolute) path for skill file operations.
   * - Project scope: relative to project root
   * - Global scope: relative to os.homedir()
   */
  private getFullPath(basePath: string, scope: 'global' | 'project'): string {
    if (scope === 'global') {
      return path.join(os.homedir(), basePath)
    }

    return path.join(this.projectRoot, basePath)
  }
}
