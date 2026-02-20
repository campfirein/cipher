import {Args, Command, Flags} from '@oclif/core'

import {
  HubEvents,
  type HubRegistryRemoveRequest,
  type HubRegistryRemoveResponse,
} from '../../../../shared/transport/events/hub-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../../lib/daemon-client.js'
import {writeJsonResponse} from '../../../lib/json-response.js'

export default class HubRegistryRemove extends Command {
  public static args = {
    name: Args.string({
      description: 'Registry name to remove',
      required: true,
    }),
  }
  public static description = 'Remove a hub registry'
  public static examples = ['<%= config.bin %> hub registry remove myco']
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  protected async executeRemove(
    params: HubRegistryRemoveRequest,
    options?: DaemonClientOptions,
  ): Promise<HubRegistryRemoveResponse> {
    return withDaemonRetry<HubRegistryRemoveResponse>(
      async (client) =>
        client.requestWithAck<HubRegistryRemoveResponse, HubRegistryRemoveRequest>(HubEvents.REGISTRY_REMOVE, params),
      options,
    )
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(HubRegistryRemove)
    const format = flags.format as 'json' | 'text'

    try {
      const result = await this.executeRemove({name: args.name})

      if (format === 'json') {
        writeJsonResponse({command: 'hub registry remove', data: result, success: result.success})
      } else {
        this.log(result.message)
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'hub registry remove', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
