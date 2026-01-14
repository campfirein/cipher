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
import type {IRuleTemplateService} from '../../../core/interfaces/i-rule-template-service.js'

import {AGENT_CONNECTOR_CONFIG} from '../../../core/domain/entities/agent.js'
import {BRV_RULE_MARKERS, BRV_RULE_TAG} from '../shared/constants.js'
import {RULES_CONNECTOR_CONFIGS} from './rules-connector-config.js'

/**
 * Options for constructing RulesConnector.
 */
type RulesConnectorOptions = {
  fileService: IFileService
  projectRoot: string
  templateService: IRuleTemplateService
}

/**
 * Connector that integrates BRV with coding agents via rule files.
 * Manages the installation, uninstallation, and status of rule files.
 */
export class RulesConnector implements IConnector {
  readonly type: ConnectorType = 'rules' as const
  private readonly fileService: IFileService
  private readonly projectRoot: string
  private readonly supportedAgents: Agent[]
  private readonly templateService: IRuleTemplateService

  constructor(options: RulesConnectorOptions) {
    this.fileService = options.fileService
    this.projectRoot = options.projectRoot
    this.templateService = options.templateService
    this.supportedAgents = Object.entries(AGENT_CONNECTOR_CONFIG)
      .filter(([_, config]) => config.supported.includes(this.type))
      .map(([agent]) => agent as Agent)
  }

  getConfigPath(agent: Agent): string {
    return RULES_CONNECTOR_CONFIGS[agent].filePath
  }

  getSupportedAgents(): Agent[] {
    return this.supportedAgents
  }

  async install(agent: Agent): Promise<ConnectorInstallResult> {
    const config = RULES_CONNECTOR_CONFIGS[agent]
    const fullPath = path.join(this.projectRoot, config.filePath)

    try {
      const exists = await this.fileService.exists(fullPath)

      if (exists) {
        const content = await this.fileService.read(fullPath)
        const hasMarkers = content.includes(BRV_RULE_MARKERS.START) && content.includes(BRV_RULE_MARKERS.END)

        // File exists but no BRV content or different agent - append or replace based on writeMode
        const ruleContent = await this.templateService.generateRuleContent(agent)

        if (config.writeMode === 'overwrite') {
          await this.fileService.write(ruleContent, fullPath, 'overwrite')
        } else if (hasMarkers) {
          // Replace existing markers section
          const newContent = this.replaceMarkerSection(content, ruleContent)
          await this.fileService.write(newContent, fullPath, 'overwrite')
        } else {
          // Append to file
          await this.fileService.write(ruleContent, fullPath, 'append')
        }

        return {
          alreadyInstalled: false,
          configPath: config.filePath,
          message: `Rules connector installed for ${agent}`,
          success: true,
        }
      }

      // File doesn't exist - create it
      const ruleContent = await this.templateService.generateRuleContent(agent)
      await this.fileService.write(ruleContent, fullPath, 'overwrite')

      return {
        alreadyInstalled: false,
        configPath: config.filePath,
        message: `Rules connector installed for ${agent} (created ${config.filePath})`,
        success: true,
      }
    } catch (error) {
      return {
        alreadyInstalled: false,
        configPath: config.filePath,
        message: `Failed to install rules connector for ${agent}: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      }
    }
  }

  isSupported(agent: Agent): boolean {
    return AGENT_CONNECTOR_CONFIG[agent].supported.includes(this.type)
  }

  async status(agent: Agent): Promise<ConnectorStatus> {
    const config = RULES_CONNECTOR_CONFIGS[agent]
    const fullPath = path.join(this.projectRoot, config.filePath)

    try {
      const exists = await this.fileService.exists(fullPath)

      if (!exists) {
        return {
          configExists: false,
          configPath: config.filePath,
          installed: false,
        }
      }

      const content = await this.fileService.read(fullPath)

      // Check for boundary markers (new format)
      const hasMarkers = content.includes(BRV_RULE_MARKERS.START) && content.includes(BRV_RULE_MARKERS.END)
      const hasAgentTag = content.includes(`${BRV_RULE_TAG} ${agent}`)

      // For overwrite files, any BRV content means installed
      // For append files, need both markers and agent tag
      const installed = config.writeMode === 'overwrite' ? hasMarkers || hasAgentTag : hasMarkers && hasAgentTag

      return {
        configExists: true,
        configPath: config.filePath,
        installed,
      }
    } catch (error) {
      return {
        configExists: true,
        configPath: config.filePath,
        error: error instanceof Error ? error.message : String(error),
        installed: false,
      }
    }
  }

  async uninstall(agent: Agent): Promise<ConnectorUninstallResult> {
    const config = RULES_CONNECTOR_CONFIGS[agent]
    const fullPath = path.join(this.projectRoot, config.filePath)

    try {
      const exists = await this.fileService.exists(fullPath)

      if (!exists) {
        return {
          configPath: config.filePath,
          message: `Rule file does not exist: ${config.filePath}`,
          success: true,
          wasInstalled: false,
        }
      }

      const content = await this.fileService.read(fullPath)
      const hasMarkers = content.includes(BRV_RULE_MARKERS.START) && content.includes(BRV_RULE_MARKERS.END)

      if (!hasMarkers) {
        // Check for legacy format (footer tag without markers)
        const hasLegacyTag = content.includes(`${BRV_RULE_TAG} ${agent}`)
        if (!hasLegacyTag) {
          return {
            configPath: config.filePath,
            message: `Rules connector is not installed for ${agent}`,
            success: true,
            wasInstalled: false,
          }
        }

        // Legacy format detected - cannot safely uninstall
        return {
          configPath: config.filePath,
          message: `Legacy rules detected for ${agent}. Please manually remove the old rules section.`,
          success: false,
          wasInstalled: true,
        }
      }

      // Remove the section between markers (inclusive)
      if (config.writeMode === 'overwrite') {
        // For dedicated files, delete the entire file
        await this.fileService.delete(fullPath)
      } else {
        // For shared files, remove only the BRV section
        const newContent = this.removeMarkerSection(content)
        // If file would be empty, delete it; otherwise write the new content
        await (newContent.trim() === ''
          ? this.fileService.delete(fullPath)
          : this.fileService.write(newContent, fullPath, 'overwrite'))
      }

      return {
        configPath: config.filePath,
        message: `Rules connector uninstalled for ${agent}`,
        success: true,
        wasInstalled: true,
      }
    } catch (error) {
      return {
        configPath: config.filePath,
        message: `Failed to uninstall rules connector for ${agent}: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
        wasInstalled: true,
      }
    }
  }

  /**
   * Removes the section between BRV markers (inclusive).
   */
  private removeMarkerSection(content: string): string {
    const startIndex = content.indexOf(BRV_RULE_MARKERS.START)
    const endIndex = content.indexOf(BRV_RULE_MARKERS.END)

    if (startIndex === -1 || endIndex === -1) {
      return content
    }

    const before = content.slice(0, startIndex)
    const after = content.slice(endIndex + BRV_RULE_MARKERS.END.length)

    // Clean up extra newlines
    return (before + after).replaceAll(/\n{3,}/g, '\n\n').trim()
  }

  /**
   * Replaces the section between BRV markers with new content.
   */
  private replaceMarkerSection(content: string, newRuleContent: string): string {
    const startIndex = content.indexOf(BRV_RULE_MARKERS.START)
    const endIndex = content.indexOf(BRV_RULE_MARKERS.END)

    if (startIndex === -1 || endIndex === -1) {
      return content
    }

    const before = content.slice(0, startIndex)
    const after = content.slice(endIndex + BRV_RULE_MARKERS.END.length)

    return before + newRuleContent + after
  }
}
