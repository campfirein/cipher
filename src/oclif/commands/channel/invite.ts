import {Args, Command, Flags} from '@oclif/core'

import {
  ChannelEvents,
  type ChannelInviteRequestT,
  type ChannelInviteResponseT,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

const MOCK_LAUNCH_ID = 'echo'

export default class ChannelInvite extends Command {
  public static args = {
    'channel-id': Args.string({description: 'Channel ID', required: true}),
  }
  public static description =
    'Invite agents to a channel by id. Phase 1 supports mock-* ids only (real-vendor invite picker lands in Phase 3).'
  public static examples = ['<%= config.bin %> channel invite auth-rotation --agent mock-a --agent mock-b --format json']
  public static flags = {
    agent: Flags.string({description: 'Agent id to invite (repeatable). Phase 1: only mock-* ids.', multiple: true, required: true}),
    format: Flags.string({options: ['json'], required: true}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ChannelInvite)
    const req: ChannelInviteRequestT = {
      agents: flags.agent.map((id) => ({
        displayName: id,
        id,
        launch: {kind: 'mock', mockId: MOCK_LAUNCH_ID},
        role: 'coding-agent',
      })),
      channelId: args['channel-id'],
    }

    const res = await withDaemonRetry<ChannelInviteResponseT>(
      async (client) => client.requestWithAck<ChannelInviteResponseT>(ChannelEvents.INVITE, req),
    )

    writeJsonResponse({command: 'channel:invite', data: res, success: true})
  }
}
