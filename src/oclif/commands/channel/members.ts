import {Args, Command, Flags} from '@oclif/core'

import {
  ChannelEvents,
  type ChannelMembersRequestT,
  type ChannelMembersResponseT,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ChannelMembers extends Command {
  public static args = {
    'channel-id': Args.string({description: 'Channel ID', required: true}),
  }
  public static description = 'List members of a channel with status + last-active timestamps.'
  public static examples = ['<%= config.bin %> channel members auth-rotation --format json']
  public static flags = {
    format: Flags.string({options: ['json'], required: true}),
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(ChannelMembers)
    const req: ChannelMembersRequestT = {channelId: args['channel-id']}

    const res = await withDaemonRetry<ChannelMembersResponseT>(
      async (client) => client.requestWithAck<ChannelMembersResponseT>(ChannelEvents.MEMBERS, req),
    )

    writeJsonResponse({command: 'channel:members', data: res, success: true})
  }
}
