import {Args, Command, Flags} from '@oclif/core'

import {
  ChannelEvents,
  type ChannelMentionRequestT,
  type ChannelMentionResponseT,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ChannelMention extends Command {
  public static args = {
    'channel-id': Args.string({description: 'Channel ID', required: true}),
    prompt: Args.string({description: 'Prompt body — include @-mentions.', required: true}),
  }
  public static description = 'Send a mention to a channel and run mentioned agents to completion.'
  public static examples = [
    '<%= config.bin %> channel mention auth-rotation "@mock-a hello" --format json',
    '<%= config.bin %> channel mention auth-rotation "@mock-a @mock-b answer in unison" --format json',
  ]
  public static flags = {
    format: Flags.string({options: ['json'], required: true}),
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(ChannelMention)
    const req: ChannelMentionRequestT = {channelId: args['channel-id'], prompt: args.prompt}

    const res = await withDaemonRetry<ChannelMentionResponseT>(
      async (client) => client.requestWithAck<ChannelMentionResponseT>(ChannelEvents.MENTION, req),
    )

    writeJsonResponse({command: 'channel:mention', data: res, success: true})
  }
}
