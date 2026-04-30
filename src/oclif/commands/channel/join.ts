import {Args, Command, Flags} from '@oclif/core'

import {
  ChannelEvents,
  type ChannelJoinRequestT,
  type ChannelJoinResponseT,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ChannelJoin extends Command {
  public static args = {
    'channel-id': Args.string({description: 'Channel ID', required: true}),
  }
  public static description = 'Join a channel — Phase 1 returns the stub message; full TUI ChannelView ships in Phase 3.'
  public static examples = ['<%= config.bin %> channel join auth-rotation --format json']
  public static flags = {
    format: Flags.string({options: ['json'], required: true}),
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(ChannelJoin)
    const req: ChannelJoinRequestT = {channelId: args['channel-id']}

    const res = await withDaemonRetry<ChannelJoinResponseT>(
      async (client) => client.requestWithAck<ChannelJoinResponseT>(ChannelEvents.JOIN, req),
    )

    writeJsonResponse({command: 'channel:join', data: res, success: true})
  }
}
