import {Command, Flags} from '@oclif/core'

import {
  ConnectorEvents,
  type ConnectorListResponse,
} from '../../../shared/transport/events/connector-events.js'
import {getConnectorName} from '../../../tui/features/connectors/utils/get-connector-name.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class Connectors extends Command {
  public static description = 'List installed agent connectors'
  public static examples = [
    '<%= config.bin %> connectors',
    '<%= config.bin %> connectors --format json',
  ]
  public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format (text or json)',
      options: ['text', 'json'],
    }),
  }

  protected async fetchConnectors(options?: DaemonClientOptions) {
    return withDaemonRetry<ConnectorListResponse>(
      async (client) => client.requestWithAck<ConnectorListResponse>(ConnectorEvents.LIST),
      options,
    )
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Connectors)
    const format = flags.format as 'json' | 'text'

    try {
      const {connectors} = await this.fetchConnectors()

      if (format === 'json') {
        writeJsonResponse({command: 'connectors', data: {connectors}, success: true})
        return
      }

      if (connectors.length === 0) {
        this.log('No connectors installed.')
      } else {
        this.log('Installed connectors:')
        for (const connector of connectors) {
          const supported = connector.supportedTypes.map((type) => getConnectorName(type)).join(', ')
          this.log(`  ${connector.agent.padEnd(20)} ${getConnectorName(connector.connectorType).padEnd(15)} (supports: ${supported})`)
        }
      }

      this.log('')
      this.log('Run "brv connectors install --help" to see available agents.')
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'connectors', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
