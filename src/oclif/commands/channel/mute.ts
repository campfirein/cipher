import {Args, Command, Flags} from '@oclif/core'

import {
  ChannelEvents,
  type ChannelMuteRequestT,
  type ChannelMuteResponseT,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ChannelMute extends Command {
  public static args = {
    'channel-id': Args.string({description: 'Channel ID', required: true}),
  }
  public static description = 'Mute / unmute an agent in a channel (mute keeps them in roster but skips routing).'
  public static examples = [
    '<%= config.bin %> channel mute auth-rotation --agent mock-a --format json',
    '<%= config.bin %> channel mute auth-rotation --agent mock-a --unmute --format json',
  ]
  public static flags = {
    agent: Flags.string({description: 'Agent id to mute / unmute.', required: true}),
    format: Flags.string({options: ['json'], required: true}),
    unmute: Flags.boolean({description: 'Unmute (default action mutes).'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ChannelMute)
    const req: ChannelMuteRequestT = {agentId: flags.agent, channelId: args['channel-id'], muted: !flags.unmute}

    const res = await withDaemonRetry<ChannelMuteResponseT>(
      async (client) => client.requestWithAck<ChannelMuteResponseT>(ChannelEvents.MUTE, req),
    )

    writeJsonResponse({command: 'channel:mute', data: res, success: true})
  }
}
