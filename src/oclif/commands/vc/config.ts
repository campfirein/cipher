import {Args, Command} from '@oclif/core'

import {isVcConfigKey, type IVcConfigResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcConfig extends Command {
  public static args = {
    key: Args.string({description: 'Config key (user.name or user.email)', required: true}),
    value: Args.string({description: 'Value to set (omit to read current value)'}),
  }
  public static description = 'Get or set commit author for ByteRover version control'
  public static examples = [
    '<%= config.bin %> <%= command.id %> user.name "Your Name"',
    '<%= config.bin %> <%= command.id %> user.email "you@example.com"',
    '<%= config.bin %> <%= command.id %> user.name',
    '<%= config.bin %> <%= command.id %> user.email',
  ]

  public async run(): Promise<void> {
    const {args} = await this.parse(VcConfig)
    const {key, value} = args

    if (!isVcConfigKey(key)) {
      this.error(`Unknown key '${key}'. Allowed: user.name, user.email.`)
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcConfigResponse>(VcEvents.CONFIG, {key, value}),
      )

      this.log(`${result.key} = ${result.value}`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
