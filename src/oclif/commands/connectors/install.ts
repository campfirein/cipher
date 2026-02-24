import {Args, Command, Flags} from '@oclif/core'

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

const agentList = AGENT_VALUES.join(', ')

export default class ConnectorsInstall extends Command {
  public static args = {
    agent: Args.string({
      description: 'Agent name to install connector for (e.g., "Claude Code", "Cursor")',
      required: true,
    }),
  }
  public static description = `Install a connector for an agent

Available agents: ${agentList}

Connector types: rules, hook, mcp, skill (not all agents support all types)`
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
        const available = agents.map((agent) => agent.id).join(', ')
        throw new Error(`Unknown agent "${agentId}". Available agents: ${available}`)
      }

      // 2. Check agent not already connected
      const {connectors} = await client.requestWithAck<ConnectorListResponse>(ConnectorEvents.LIST)
      const existing = connectors.find((connector) => connector.agent.toLowerCase() === matchedAgent.id.toLowerCase())

      if (existing) {
        throw new Error(
          `"${matchedAgent.id}" is already connected via ${getConnectorName(existing.connectorType)}.`
          + ` Use "brv connectors switch ${matchedAgent.id} --type <type>" to change the connector type.`,
        )
      }

      // 3. Resolve and validate connector type
      const resolvedType = connectorType ?? matchedAgent.defaultConnectorType
      const supported = matchedAgent.supportedConnectorTypes.map((type) => getConnectorName(type)).join(', ')

      if (!isConnectorType(resolvedType) || !matchedAgent.supportedConnectorTypes.includes(resolvedType)) {
        throw new Error(
          `"${matchedAgent.id}" does not support "${resolvedType}". Supported types: ${supported}`,
        )
      }

      // 4. Install
      const result = await client.requestWithAck<ConnectorInstallResponse>(
        ConnectorEvents.INSTALL,
        {agentId: matchedAgent.id, connectorType: resolvedType},
      )

      if (!result.success) {
        throw new Error(result.message)
      }

      return {agentId: matchedAgent.id, connectorType: resolvedType, result}
    }, options)
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ConnectorsInstall)
    const format = flags.format as 'json' | 'text'

    try {
      const {agentId, connectorType, result} = await this.installConnector({
        agentId: args.agent,
        connectorType: flags.type,
      })

      if (format === 'json') {
        writeJsonResponse({
          command: 'connectors install',
          data: {agentId, configPath: result.configPath, connectorType},
          success: true,
        })
      } else {
        this.log(`${agentId} connected via ${getConnectorName(connectorType)}.`)
        if (requiresAgentRestart(connectorType)) {
          this.log(`\nPlease restart ${agentId} to apply the new ${getConnectorName(connectorType)}.`)
        }
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
