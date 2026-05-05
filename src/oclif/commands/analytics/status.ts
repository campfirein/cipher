import {Command, Flags} from '@oclif/core'

import {
  GlobalConfigEvents,
  type GlobalConfigGetResponse,
} from '../../../shared/transport/events/global-config-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

const COMMAND_ID = 'analytics:status'

export default class Status extends Command {
  public static description = `Show whether ByteRover CLI analytics is enabled or disabled.

Analytics is opt-in (default: off). When enabled, ByteRover collects anonymous
usage telemetry (event names, CLI version, OS, Node version, environment) to
improve the product. No content of your queries, files, or memory is collected.

Privacy policy: https://byterover.dev/privacy  (placeholder until M1.5)
Toggle: brv analytics enable | brv analytics disable`
  public static examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --format json']
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  protected async fetchAnalyticsEnabled(options?: DaemonClientOptions): Promise<boolean> {
    return withDaemonRetry<boolean>(async (client) => {
      const response = await client.requestWithAck<GlobalConfigGetResponse>(GlobalConfigEvents.GET)
      return response.analytics
    }, options)
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Status)
    const isJson = flags.format === 'json'

    try {
      const enabled = await this.fetchAnalyticsEnabled({projectPath: process.cwd()})
      const label = enabled ? 'enabled' : 'disabled'

      if (isJson) {
        writeJsonResponse({command: COMMAND_ID, data: {analytics: label}, success: true})
      } else {
        this.log(`Analytics: ${label}`)
      }
    } catch (error) {
      if (isJson) {
        writeJsonResponse({command: COMMAND_ID, data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
