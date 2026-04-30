import {Args, Command, Flags} from '@oclif/core'

import {
  type ChannelArchiveRequestT,
  type ChannelArchiveResponseT,
  ChannelEvents,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ChannelArchive extends Command {
  public static args = {
    'channel-id': Args.string({description: 'Channel ID', required: true}),
  }
  public static description = 'Mark a channel archived (preserves all turns and artifacts).'
  public static examples = ['<%= config.bin %> channel archive auth-rotation --format json']
  public static flags = {
    format: Flags.string({options: ['json'], required: true}),
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(ChannelArchive)
    const req: ChannelArchiveRequestT = {channelId: args['channel-id']}

    const res = await withDaemonRetry<ChannelArchiveResponseT>(
      async (client) => client.requestWithAck<ChannelArchiveResponseT>(ChannelEvents.ARCHIVE, req),
    )

    writeJsonResponse({command: 'channel:archive', data: res, success: true})
  }
}
