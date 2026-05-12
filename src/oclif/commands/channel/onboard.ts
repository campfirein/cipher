import {Args, Command, Flags} from '@oclif/core'

import type {
  ChannelOnboardRequest,
  ChannelOnboardResponse,
} from '../../../shared/transport/events/channel-events.js'

import {ChannelEvents} from '../../../shared/transport/events/channel-events.js'
import {ChannelClientError, withChannelClient} from '../../lib/channel-client.js'

export default class ChannelOnboard extends Command {
  public static args = {
    name: Args.string({description: 'Profile name (used by `brv channel invite --profile <name>`)', required: true}),
  }
public static description = 'Probe an ACP agent and persist a driver profile (Phase 3)'
public static examples = [
    '<%= config.bin %> <%= command.id %> mock -- node test/fixtures/mock-acp.js',
    '<%= config.bin %> <%= command.id %> kimi -- kimi acp',
  ]
public static flags = {
    'display-name': Flags.string({description: 'Friendly display name (defaults to the profile name)'}),
    json: Flags.boolean({default: false, description: 'Emit JSON instead of pretty output'}),
  }
// Accept the trailing invocation tokens (after `--`).
  public static strict = false

  public async run(): Promise<void> {
    const {args, argv, flags} = await this.parse(ChannelOnboard)
    const tail = argv.slice(1).filter((v): v is string => typeof v === 'string')
    if (tail.length === 0) {
      this.error('Inline invocation is required: `brv channel onboard <name> -- <command> [args...]`', {exit: 1})
    }

    const [command, ...commandArgs] = tail

    try {
      const response = await withChannelClient(async (client) =>
        client.request<ChannelOnboardRequest, ChannelOnboardResponse>(ChannelEvents.ONBOARD, {
          displayName: flags['display-name'] ?? args.name,
          invocation: {args: commandArgs, command, cwd: process.cwd()},
          profileName: args.name,
        }),
      )

      if (flags.json) {
        this.log(JSON.stringify(response, undefined, 2))
        return
      }

      const {profile} = response
      const caps = profile.capabilities?.length ? `, capabilities: [${profile.capabilities.join(', ')}]` : ''
      this.log(`✓ Profile \`${profile.name}\` saved (class: ${profile.driverClass}${caps}).`)
      for (const d of response.diagnostics) {
        if (d.severity === 'info') continue
        this.log(`  [${d.severity}] ${d.message}`)
      }
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
