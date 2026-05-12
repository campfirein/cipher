import {Args, Command, Flags} from '@oclif/core'

import type {
  ChannelInviteRequest,
  ChannelInviteResponse,
} from '../../../shared/transport/events/channel-events.js'

import {ChannelEvents} from '../../../shared/transport/events/channel-events.js'
import {ChannelClientError, withChannelClient} from '../../lib/channel-client.js'

export default class ChannelInvite extends Command {
  public static args = {
    channelId: Args.string({description: 'Channel handle', required: true}),
    handle: Args.string({description: 'Member handle (must start with @)', required: true}),
  }
public static description = 'Invite an ACP agent into a channel and run initialize synchronously'
public static examples = [
    '<%= config.bin %> <%= command.id %> pi-test @mock -- node test/fixtures/mock-acp.js',
    '<%= config.bin %> <%= command.id %> pi-test @kimi -- kimi acp',
    '<%= config.bin %> <%= command.id %> pi-test @mock --profile mock',
  ]
public static flags = {
    json: Flags.boolean({default: false, description: 'Emit JSON instead of pretty output'}),
    profile: Flags.string({description: 'Use a persisted driver profile name (Phase 3) instead of an inline invocation'}),
  }
// Accept the trailing invocation tokens (after `--`).
  public static strict = false

  public async run(): Promise<void> {
    const {args, argv, flags} = await this.parse(ChannelInvite)
    if (!args.handle.startsWith('@')) {
      this.error(`Member handle must start with @ (got "${args.handle}")`, {exit: 1})
    }

    // After the two named args (`channelId`, `handle`) the remaining argv is
    // the inline invocation: command + args. Oclif strips the leading `--`
    // separator before us, so argv[0] is the first invocation token.
    const tail = argv.slice(2).filter((v): v is string => typeof v === 'string')

    let payload: ChannelInviteRequest
    if (flags.profile === undefined) {
      if (tail.length === 0) {
        this.error(
          'Invocation is required: `brv channel invite <ch> <@h> -- <command> [args...]` OR `--profile <name>`',
          {exit: 1},
        )
      }

      const [command, ...commandArgs] = tail
      payload = {
        channelId: args.channelId,
        handle: args.handle,
        invocation: {args: commandArgs, command, cwd: process.cwd()},
      }
    } else {
      if (tail.length > 0) {
        this.error('Use either --profile <name> OR inline `-- <command>`, not both.', {exit: 1})
      }

      payload = {channelId: args.channelId, handle: args.handle, profileName: flags.profile}
    }

    try {
      const response = await withChannelClient(async (client) =>
        client.request<ChannelInviteRequest, ChannelInviteResponse>(ChannelEvents.INVITE, payload),
      )

      if (flags.json) {
        this.log(JSON.stringify(response, undefined, 2))
        return
      }

      const {member} = response
      if (member.memberKind !== 'acp-agent') {
        this.log(`✓ Member ${args.handle} joined #${args.channelId}`)
        return
      }

      const capsClause = member.capabilities.length > 0 ? `, capabilities: [${member.capabilities.join(', ')}]` : ''
      this.log(
        `✓ Member ${args.handle} joined #${args.channelId} (driver: ${member.driverClass}, acpVersion: ${member.acpVersion ?? '?'}${capsClause})`,
      )
    } catch (error) {
      this.handleError(error, flags.json)
    }
  }

  private handleError(error: unknown, asJson: boolean): never {
    if (error instanceof ChannelClientError) {
      if (asJson) {
        this.log(JSON.stringify({code: error.code, error: error.message, success: false}))
      } else {
        this.logToStderr(`[${error.code}] ${error.message}`)
      }

      this.exit(1)
    }

    throw error
  }
}
