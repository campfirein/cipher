import {Args, Command, Flags} from '@oclif/core'

import {
  ChannelEvents,
  type ChannelLeaveRequestT,
  type ChannelLeaveResponseT,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ChannelLeave extends Command {
  public static args = {
    'channel-id': Args.string({description: 'Channel ID', required: true}),
  }
  public static description = 'Remove an agent from a channel (reversible — re-invite to bring back).'
  public static examples = ['<%= config.bin %> channel leave auth-rotation --agent mock-a --format json']
  public static flags = {
    agent: Flags.string({description: 'Agent id to remove.', required: true}),
    format: Flags.string({options: ['json'], required: true}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ChannelLeave)
    const req: ChannelLeaveRequestT = {agentId: flags.agent, channelId: args['channel-id']}

    const res = await withDaemonRetry<ChannelLeaveResponseT>(
      async (client) => client.requestWithAck<ChannelLeaveResponseT>(ChannelEvents.LEAVE, req),
    )

    writeJsonResponse({command: 'channel:leave', data: res, success: true})
  }
}
