import {Command, Flags} from '@oclif/core'

import {
  ChannelEvents,
  type ChannelListResponseT,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ChannelList extends Command {
  public static description = 'List all channels.'
  public static examples = ['<%= config.bin %> channel list --format json']
  public static flags = {
    format: Flags.string({options: ['json'], required: true}),
  }

  public async run(): Promise<void> {
    const res = await withDaemonRetry<ChannelListResponseT>(
      async (client) => client.requestWithAck<ChannelListResponseT>(ChannelEvents.LIST),
    )

    writeJsonResponse({command: 'channel:list', data: res, success: true})
  }
}
