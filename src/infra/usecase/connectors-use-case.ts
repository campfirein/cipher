import type {Agent} from '../../core/domain/entities/agent.js'
import type {ConnectorType} from '../../core/domain/entities/connector-type.js'
import type {IConnectorManager} from '../../core/interfaces/connectors/i-connector-manager.js'
import type {ITerminal} from '../../core/interfaces/i-terminal.js'
import type {ITrackingService} from '../../core/interfaces/i-tracking-service.js'

import {AGENT_VALUES} from '../../core/domain/entities/agent.js'
import {IConnectorsUseCase} from '../../core/interfaces/usecase/i-connectors-use-case.js'

/** Sentinel value for "Connect a new agent" option */
const CONNECT_NEW_AGENT = '__connect_new__' as const

/**
 * Array of all agents with name and value properties.
 * Useful for UI components like select dropdowns.
 */
const AGENTS = AGENT_VALUES.map((agent) => ({
  name: agent,
  value: agent,
}))

/**
 * Options for constructing ConnectorsUseCase.
 */
export interface ConnectorsUseCaseOptions {
  connectorManager: IConnectorManager
  terminal: ITerminal
  trackingService: ITrackingService
}

/**
 * Use case for managing connectors.
 * Shows list of connected agents and allows managing or adding new connections.
 */
export class ConnectorsUseCase implements IConnectorsUseCase {
  private readonly connectorManager: IConnectorManager
  private readonly terminal: ITerminal
  private readonly trackingService: ITrackingService

  constructor(options: ConnectorsUseCaseOptions) {
    this.connectorManager = options.connectorManager
    this.terminal = options.terminal
    this.trackingService = options.trackingService
  }

  public async run(): Promise<void> {
    await this.trackingService.track('connectors:configure')

    // Step 1: Get all installed connectors
    const installedConnectors = await this.connectorManager.getAllInstalledConnectors()

    // Step 2: Show list or prompt for new agent
    const selectedAgent =
      installedConnectors.size === 0
        ? await this.handleNoConnectorsInstalled()
        : await this.handleExistingConnectors(installedConnectors)

    // Step 3: Get current status and supported types for selected agent
    const currentType = await this.connectorManager.getInstalledConnectorType(selectedAgent)
    const supportedTypes = this.connectorManager.getSupportedConnectorTypes(selectedAgent)

    // Step 4: Select connector type
    const selectedType = await this.promptForConnectorType(selectedAgent, supportedTypes, currentType)

    // Step 5: Handle switching with confirmation if needed
    if (currentType && currentType !== selectedType) {
      const shouldSwitch = await this.promptForSwitchConfirmation(selectedAgent, currentType, selectedType)
      if (!shouldSwitch) {
        this.terminal.log(`Kept ${selectedAgent} connected via ${currentType}`)
        return
      }
    }

    // Step 6: Install the selected connector
    await this.installConnector(selectedAgent, selectedType)
  }

  /**
   * Display manual setup instructions for MCP configuration.
   */
  private displayManualInstructions(agent: Agent, instructions: {configContent: string; guide: string}): void {
    this.terminal.log(`\nManual setup required for ${agent}`)
    this.terminal.log('')
    this.terminal.log('Add this configuration to your MCP settings:')
    this.terminal.log('')
    this.terminal.log(instructions.configContent)
    this.terminal.log('')

    if (instructions.guide) {
      this.terminal.log(`\nFor detailed instructions, see: ${instructions.guide}`)
    }
  }

  /**
   * Gets a description for a connector type.
   */
  private getConnectorDescription(type: ConnectorType, configPath: string): string {
    switch (type) {
      case 'hook': {
        return `Instructions injected on each prompt (${configPath})`
      }

      case 'mcp': {
        return `Agent connects via MCP protocol ${configPath ? `(${configPath})` : ''}`
      }

      case 'rules': {
        return `Agent reads instructions from rule file (${configPath})`
      }

      case 'skill': {
        return `Agent reads skill files from project directory (${configPath})`
      }
    }
  }

  /**
   * Gets a human-readable label for a connector type.
   */
  private getConnectorLabel(type: ConnectorType): string {
    switch (type) {
      case 'hook': {
        return 'Hook'
      }

      case 'mcp': {
        return 'MCP'
      }

      case 'rules': {
        return 'Rules'
      }

      case 'skill': {
        return 'Skill'
      }
    }
  }

  /**
   * Handles the case when connectors are already installed.
   */
  private async handleExistingConnectors(installedConnectors: Map<Agent, ConnectorType>): Promise<Agent> {
    const selection = await this.promptForAgentToManage(installedConnectors)

    if (selection === CONNECT_NEW_AGENT) {
      return this.promptForNewAgentSelection(installedConnectors)
    }

    return selection
  }

  /**
   * Handles the case when no connectors are installed.
   */
  private async handleNoConnectorsInstalled(): Promise<Agent> {
    this.terminal.log('No agents connected yet.\n')
    return this.promptForNewAgentSelection()
  }

  /**
   * Installs the selected connector and displays result.
   */
  private async installConnector(agent: Agent, connectorType: ConnectorType): Promise<void> {
    const result = await this.connectorManager.switchConnector(agent, connectorType)

    if (result.success) {
      // Handle manual setup instructions
      if (result.installResult.requiresManualSetup && result.installResult.manualInstructions) {
        this.displayManualInstructions(agent, result.installResult.manualInstructions)
        return
      }

      if (result.fromType && result.fromType !== result.toType) {
        this.terminal.log(
          `${agent} switched from ${this.getConnectorLabel(result.fromType)} to ${this.getConnectorLabel(result.toType)}`,
        )
        if (result.uninstallResult?.wasInstalled) {
          this.terminal.log(`   Uninstalled: ${result.uninstallResult.configPath}`)
        }

        this.terminal.log(`   Installed: ${result.installResult.configPath}`)
      } else if (result.installResult.alreadyInstalled) {
        this.terminal.log(`${agent} is already connected via ${result.toType}`)
        this.terminal.log(`   Config: ${result.installResult.configPath}`)
      } else {
        this.terminal.log(`${agent} connected via ${result.toType}`)
        this.terminal.log(`   Installed: ${result.installResult.configPath}`)
      }

      // Show restart message for hook connector
      if (['hook', 'mcp', 'skill'].includes(result.toType) && !result.installResult.alreadyInstalled) {
        this.terminal.warn(`\n⚠️  Please restart ${agent} to apply the new ${result.toType}.`)
      }
    } else {
      this.terminal.error(`Failed to configure ${agent}: ${result.message}`)
    }
  }

  /**
   * Prompts user to select from connected agents or add new.
   */
  private async promptForAgentToManage(
    installedConnectors: Map<Agent, ConnectorType>,
  ): Promise<Agent | typeof CONNECT_NEW_AGENT> {
    const choices: Array<{description?: string; name: string; value: Agent | typeof CONNECT_NEW_AGENT}> = []

    // Add installed agents as choices
    for (const [agent, connectorType] of installedConnectors) {
      const connector = this.connectorManager.getConnector(connectorType)
      const configPath = connector.getConfigPath(agent)

      choices.push({
        description: configPath,
        name: `${agent} (${this.getConnectorLabel(connectorType)})`,
        value: agent,
      })
    }

    // Add separator and "Connect new" option
    choices.push({
      name: '+ Connect a new agent',
      value: CONNECT_NEW_AGENT,
    })

    return this.terminal.select({
      choices,
      message: 'Manage agent connectors:',
    })
  }

  /**
   * Prompts the user to select a connector type.
   */
  private async promptForConnectorType(
    agent: Agent,
    supportedTypes: ConnectorType[],
    currentType: ConnectorType | null,
  ): Promise<ConnectorType> {
    const choices = supportedTypes.map((type) => {
      const connector = this.connectorManager.getConnector(type)
      const configPath = connector.getConfigPath(agent)
      const isCurrent = type === currentType
      const label = this.getConnectorLabel(type)
      const description = this.getConnectorDescription(type, configPath)

      return {
        description,
        name: isCurrent ? `${label} (current)` : label,
        value: type,
      }
    })

    return this.terminal.select({
      choices,
      message: 'Select connector type:',
    })
  }

  /**
   * Prompts user to select a new agent (excludes already connected agents).
   */
  private async promptForNewAgentSelection(installedConnectors?: Map<Agent, ConnectorType>): Promise<Agent> {
    const connectedAgents = installedConnectors ? new Set(installedConnectors.keys()) : new Set<Agent>()

    // Filter out already connected agents
    const availableAgents = AGENTS.filter((agent) => !connectedAgents.has(agent.value))

    return this.terminal.search({
      message: 'Which agent are you using (type to search):',
      source(input) {
        if (!input) return availableAgents
        return availableAgents.filter(
          (agent) =>
            agent.name.toLowerCase().includes(input.toLowerCase()) ||
            agent.value.toLowerCase().includes(input.toLowerCase()),
        )
      },
    })
  }

  /**
   * Prompts the user to confirm switching connectors.
   */
  private async promptForSwitchConfirmation(
    agent: Agent,
    fromType: ConnectorType,
    toType: ConnectorType,
  ): Promise<boolean> {
    const fromConnector = this.connectorManager.getConnector(fromType)
    const fromPath = fromConnector.getConfigPath(agent)

    this.terminal.warn(
      `${agent} is currently connected via ${this.getConnectorLabel(fromType)} ${fromPath ? `(${fromPath})` : ''}`,
    )

    return this.terminal.confirm({
      default: true,
      message: `Switch to ${toType}? This will uninstall the current connector.`,
    })
  }
}
