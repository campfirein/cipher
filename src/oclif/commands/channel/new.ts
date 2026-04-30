import {Args, Command, Flags} from '@oclif/core'

import {
  ChannelCreateRequest,
  type ChannelCreateRequestT,
  type ChannelCreateResponseT,
  ChannelEvents,
} from '../../../shared/transport/events/channel-events.js'
import {withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class ChannelNew extends Command {
  public static args = {
    'channel-id': Args.string({description: 'Channel ID (slug)', required: true}),
  }
  public static description = 'Create a new channel under the current project tree (or --global / --isolated).'
  public static examples = [
    '<%= config.bin %> channel new auth-rotation --format json',
    '<%= config.bin %> channel new research --global --format json',
  ]
  public static flags = {
    format: Flags.string({options: ['json'], required: true}),
    global: Flags.boolean({description: 'Use the global tree instead of the project tree.'}),
    isolated: Flags.boolean({description: 'Create an isolated tree just for this channel.'}),
    'tree-root': Flags.string({description: 'Override resolved tree root (advanced).'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ChannelNew)
    const scope = flags.global ? 'global' : flags.isolated ? 'isolated' : 'project'
    const req: ChannelCreateRequestT = ChannelCreateRequest.parse({
      channelId: args['channel-id'],
      scope,
      ...(flags['tree-root'] === undefined ? {} : {treeRootHint: flags['tree-root']}),
    })

    const res = await withDaemonRetry<ChannelCreateResponseT>(
      async (client) => client.requestWithAck<ChannelCreateResponseT>(ChannelEvents.CREATE, req),
    )

    writeJsonResponse({command: 'channel:new', data: res, success: true})
  }
}
