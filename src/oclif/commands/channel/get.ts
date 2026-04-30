import {Args, Command, Flags} from '@oclif/core'

import {
  ChannelEvents,
  type ChannelGetRequestT,
  type ChannelGetResponseT,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ChannelGet extends Command {
  public static args = {
    'channel-id': Args.string({description: 'Channel ID', required: true}),
  }
  public static description = 'Read a channel’s metadata + member roster.'
  public static examples = ['<%= config.bin %> channel get auth-rotation --format json']
  public static flags = {
    format: Flags.string({options: ['json'], required: true}),
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(ChannelGet)
    const req: ChannelGetRequestT = {channelId: args['channel-id']}

    const res = await withDaemonRetry<ChannelGetResponseT>(
      async (client) => client.requestWithAck<ChannelGetResponseT>(ChannelEvents.GET, req),
    )

    writeJsonResponse({command: 'channel:get', data: res, success: true})
  }
}
