import {Args, Command, Flags} from '@oclif/core'

import {
  type ChannelCancelRequestT,
  type ChannelCancelResponseT,
  ChannelEvents,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ChannelCancel extends Command {
  public static args = {
    'channel-id': Args.string({description: 'Channel ID', required: true}),
    'turn-id': Args.string({description: 'Turn id to cancel.', required: true}),
  }
  public static description = 'Cancel an in-flight turn. Phase 1: surface only — orchestrator-side cancel wires in Phase 2.'
  public static examples = ['<%= config.bin %> channel cancel auth-rotation t-001 --format json']
  public static flags = {
    format: Flags.string({options: ['json'], required: true}),
  }

  public async run(): Promise<void> {
    const {args} = await this.parse(ChannelCancel)
    const req: ChannelCancelRequestT = {channelId: args['channel-id'], turnId: args['turn-id']}

    const res = await withDaemonRetry<ChannelCancelResponseT>(
      async (client) => client.requestWithAck<ChannelCancelResponseT>(ChannelEvents.CANCEL, req),
    )

    writeJsonResponse({command: 'channel:cancel', data: res, success: true})
  }
}
