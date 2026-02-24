import {Args, Command, Flags} from '@oclif/core'

import {
  ConnectorEvents,
  type ConnectorInstallResponse,
  type ConnectorListResponse,
} from '../../../shared/transport/events/connector-events.js'
import {isConnectorType, requiresAgentRestart} from '../../../shared/types/connector-type.js'
import {getConnectorName} from '../../../tui/features/connectors/utils/get-connector-name.js'
import {type DaemonClientOptions, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ConnectorsSwitch extends Command {
  public static args = {
    agent: Args.string({
      description: 'Agent name to switch connector type for',
      required: true,
    }),
  }
  public static description = 'Switch the connector type for an installed agent'
  public static examples = [
    '<%= config.bin %> connectors switch "Claude Code" --type mcp',
    '<%= config.bin %> connectors switch Cursor --type rules',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
    type: Flags.string({
      char: 't',
      description: 'New connector type (rules, hook, mcp, skill)',
      options: ['rules', 'hook', 'mcp', 'skill'],
      required: true,
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ConnectorsSwitch)
    const format = flags.format as 'json' | 'text'

    try {
      const switchResult = await this.switchConnector({
        agentId: args.agent,
        connectorType: flags.type,
      })

      if (format === 'json') {
        writeJsonResponse({
          command: 'connectors switch',
          data: {
            agentId: switchResult.agentId,
            connectorType: switchResult.connectorType,
            ...(switchResult.alreadySameType ? {message: 'Already using this connector type'} : {}),
          },
          success: true,
        })
        return
      }

      if (switchResult.alreadySameType) {
        this.log(`"${switchResult.agentId}" is already using ${getConnectorName(switchResult.connectorType)}.`)
        return
      }

      this.log(
        `${switchResult.agentId} switched from ${getConnectorName(switchResult.fromType!)} to ${getConnectorName(switchResult.connectorType)}.`,
      )

      if (requiresAgentRestart(switchResult.connectorType)) {
        this.log(`\nPlease restart ${switchResult.agentId} to apply the new ${getConnectorName(switchResult.connectorType)}.`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to switch connector type.'
      if (format === 'json') {
        writeJsonResponse({command: 'connectors switch', data: {error: errorMessage}, success: false})
      } else {
        this.log(errorMessage)
      }
    }
  }

  protected async switchConnector(
    {agentId, connectorType}: {agentId: string; connectorType: string},
    options?: DaemonClientOptions,
  ) {
    return withDaemonRetry(async (client) => {
      // 1. Find existing connector
      const {connectors} = await client.requestWithAck<ConnectorListResponse>(ConnectorEvents.LIST)
      const existing = connectors.find((connector) => connector.agent.toLowerCase() === agentId.toLowerCase())

      if (!existing) {
        throw new Error(
          `"${agentId}" is not connected. Use "brv connectors install ${agentId}" to install a connector first.`,
        )
      }

      // 2. Check if same type
      if (existing.connectorType === connectorType) {
        return {agentId: existing.agent, alreadySameType: true, connectorType}
      }

      // 3. Validate new type
      const supported = existing.supportedTypes.map((type) => getConnectorName(type)).join(', ')

      if (!isConnectorType(connectorType) || !existing.supportedTypes.includes(connectorType)) {
        throw new Error(
          `"${existing.agent}" does not support "${connectorType}". Supported types: ${supported}`,
        )
      }

      // 4. Switch
      const result = await client.requestWithAck<ConnectorInstallResponse>(
        ConnectorEvents.INSTALL,
        {agentId: existing.agent, connectorType},
      )

      if (!result.success) {
        throw new Error(result.message)
      }

      return {agentId: existing.agent, alreadySameType: false, connectorType, fromType: existing.connectorType, result}
    }, options)
  }
}
