import {Command} from '@oclif/core'

import {
  GlobalConfigEvents,
  type GlobalConfigSetAnalyticsResponse,
} from '../../../shared/transport/events/global-config-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class Enable extends Command {
  public static description = `Enable ByteRover CLI analytics.

Anonymous usage telemetry will be collected to improve the product.
No content of your queries, files, or memory is collected.

Privacy policy: https://byterover.dev/privacy  (placeholder until M1.5)
Disable any time with: brv analytics disable`
  public static examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    try {
      const response = await this.setAnalytics(true, {projectPath: process.cwd()})
      this.log(response.previous === response.current ? 'Analytics already enabled' : 'Analytics enabled')
    } catch (error) {
      this.log(formatConnectionError(error))
    }
  }

  protected async setAnalytics(
    analytics: boolean,
    options?: DaemonClientOptions,
  ): Promise<GlobalConfigSetAnalyticsResponse> {
    return withDaemonRetry<GlobalConfigSetAnalyticsResponse>(
      async (client) =>
        client.requestWithAck<GlobalConfigSetAnalyticsResponse>(GlobalConfigEvents.SET_ANALYTICS, {analytics}),
      options,
    )
  }
}
