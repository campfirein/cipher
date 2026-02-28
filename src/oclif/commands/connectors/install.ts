import {Args, Command, Flags} from '@oclif/core'

import {AGENT_CONNECTOR_CONFIG} from '../../../server/core/domain/entities/agent.js'
import {
  ConnectorEvents,
  type ConnectorGetAgentsResponse,
  type ConnectorInstallResponse,
  type ConnectorListResponse,
} from '../../../shared/transport/events/connector-events.js'
import {AGENT_VALUES} from '../../../shared/types/agent.js'
import {isConnectorType, requiresAgentRestart} from '../../../shared/types/connector-type.js'
import {getConnectorName} from '../../../tui/features/connectors/utils/get-connector-name.js'
import {type DaemonClientOptions, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

const agentTable = AGENT_VALUES.map((agent) => {
  const config = AGENT_CONNECTOR_CONFIG[agent]
  const supported = config.supported.map((type) => getConnectorName(type)).join(', ')
  return `  ${agent.padEnd(20)} ${getConnectorName(config.default).padEnd(15)} ${supported}`
}).join('\n')

export default class ConnectorsInstall extends Command {
  public static args = {
    agent: Args.string({
      description: 'Agent name to install connector for (e.g., "Claude Code", "Cursor")',
      required: true,
    }),
  }
  public static description = `Install or switch a connector for an agent

  Connector Types:
    Rules       Agent reads instructions from rule file
    Hook        Instructions injected on each prompt
    MCP         Agent connects via MCP protocol
    Agent Skill Agent reads skill files from project directory

  ${'Available agents'.padEnd(20)} ${'Default'.padEnd(15)} Supported Types
  ${'─'.repeat(20)} ${'─'.repeat(15)} ${'─'.repeat(25)}
${agentTable}`
  public static examples = [
    '<%= config.bin %> connectors install "Claude Code"',
    '<%= config.bin %> connectors install "Claude Code" --type mcp',
    '<%= config.bin %> connectors install Cursor --type rules',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    type: Flags.string({
      char: 't',
      description: "Connector type (rules, hook, mcp, skill). Defaults to agent's recommended type.",
      options: ['rules', 'hook', 'mcp', 'skill'],
    }),
  }

  protected async installConnector(
    {agentId, connectorType}: {agentId: string; connectorType?: string},
    options?: DaemonClientOptions,
  ) {
    return withDaemonRetry(async (client) => {
      // 1. Get all agents and find match
      const {agents} = await client.requestWithAck<ConnectorGetAgentsResponse>(ConnectorEvents.GET_AGENTS)
      const matchedAgent = agents.find((agent) => agent.id.toLowerCase() === agentId.toLowerCase())

      if (!matchedAgent) {
        throw new Error(`Unknown agent "${agentId}". Run "brv connectors install --help" to see available agents.`)
      }

      // 2. Check if already connected
      const {connectors} = await client.requestWithAck<ConnectorListResponse>(ConnectorEvents.LIST)
      const existing = connectors.find((connector) => connector.agent.toLowerCase() === matchedAgent.id.toLowerCase())

      // 3. Resolve and validate connector type
      const resolvedType = connectorType ?? existing?.connectorType ?? matchedAgent.defaultConnectorType
      const supported = matchedAgent.supportedConnectorTypes.map((type) => getConnectorName(type)).join(', ')

      if (!isConnectorType(resolvedType) || !matchedAgent.supportedConnectorTypes.includes(resolvedType)) {
        throw new Error(
          `"${matchedAgent.id}" does not support "${resolvedType}". Supported types: ${supported}`,
        )
      }

      // 4. If already connected with same type, no action needed
      if (existing && existing.connectorType === resolvedType) {
        return {agentId: matchedAgent.id, alreadySameType: true, connectorType: resolvedType}
      }

      // 5. Install or switch
      const result = await client.requestWithAck<ConnectorInstallResponse>(
        ConnectorEvents.INSTALL,
        {agentId: matchedAgent.id, connectorType: resolvedType},
      )

      if (!result.success) {
        throw new Error(result.message)
      }

      return {
        agentId: matchedAgent.id,
        alreadySameType: false,
        connectorType: resolvedType,
        fromType: existing?.connectorType,
        result,
      }
    }, options)
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ConnectorsInstall)
    const format = flags.format as 'json' | 'text'

    try {
      const installResult = await this.installConnector({
        agentId: args.agent,
        connectorType: flags.type,
      })

      if (format === 'json') {
        writeJsonResponse({
          command: 'connectors install',
          data: {
            agentId: installResult.agentId,
            configPath: installResult.result?.configPath,
            connectorType: installResult.connectorType,
            ...(installResult.alreadySameType ? {message: 'Already using this connector type'} : {}),
            ...(installResult.result?.requiresManualSetup ? {
              manualInstructions: installResult.result.manualInstructions,
              requiresManualSetup: true,
            } : {}),
          },
          success: true,
        })
        return
      }

      if (installResult.alreadySameType) {
        this.log(`"${installResult.agentId}" is already using ${getConnectorName(installResult.connectorType)}.`)
        return
      }

      if (installResult.result?.requiresManualSetup && installResult.result.manualInstructions) {
        this.log(`\nManual setup required for ${installResult.agentId}`)
        this.log('')
        this.log('Add this configuration to your MCP settings:')
        this.log('')
        this.log(installResult.result.manualInstructions.configContent)
        if (installResult.result.manualInstructions.guide) {
          this.log('')
          this.log(`For detailed instructions, see: ${installResult.result.manualInstructions.guide}`)
        }

        return
      }

      if (installResult.fromType) {
        this.log(
          `${installResult.agentId} switched from ${getConnectorName(installResult.fromType)} to ${getConnectorName(installResult.connectorType)}.`,
        )
      } else {
        this.log(`${installResult.agentId} connected via ${getConnectorName(installResult.connectorType)}.`)
      }

      if (installResult.result?.configPath) {
        this.log(`Location: ${installResult.result.configPath}`)
      }

      if (requiresAgentRestart(installResult.connectorType)) {
        this.log(`\nPlease restart ${installResult.agentId} to apply the new ${getConnectorName(installResult.connectorType)}.`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to install connector.'
      if (format === 'json') {
        writeJsonResponse({command: 'connectors install', data: {error: errorMessage}, success: false})
      } else {
        this.log(errorMessage)
      }
    }
  }
}
