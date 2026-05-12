import {Args, Command, Flags} from '@oclif/core'

import type {
  ChannelProfileShowRequest,
  ChannelProfileShowResponse,
} from '../../../../shared/transport/events/channel-events.js'

import {ChannelEvents} from '../../../../shared/transport/events/channel-events.js'
import {ChannelClientError, withChannelClient} from '../../../lib/channel-client.js'

export default class ChannelProfileShow extends Command {
  public static args = {
    name: Args.string({description: 'Profile name', required: true}),
  }
public static description = 'Inspect a driver profile by name (Phase 3)'
public static examples = ['<%= config.bin %> <%= command.id %> mock', '<%= config.bin %> <%= command.id %> mock --json']
public static flags = {
    json: Flags.boolean({default: false, description: 'Emit JSON instead of pretty output'}),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(ChannelProfileShow)
    try {
      const response = await withChannelClient(async (client) =>
        client.request<ChannelProfileShowRequest, ChannelProfileShowResponse>(
          ChannelEvents.PROFILE_SHOW,
          {name: args.name},
        ),
      )

      if (flags.json) {
        this.log(JSON.stringify(response, undefined, 2))
        return
      }

      const {profile} = response
      this.log(`${profile.name} (${profile.displayName})`)
      this.log(`  driver class: ${profile.driverClass}`)
      this.log(`  invocation:   ${profile.invocation.command} ${profile.invocation.args.join(' ')}`)
      if (profile.detectedAcpVersion !== undefined) this.log(`  acpVersion:   ${profile.detectedAcpVersion}`)
      if (profile.capabilities?.length) this.log(`  capabilities: ${profile.capabilities.join(', ')}`)
      if (profile.probedAt !== undefined) this.log(`  probedAt:     ${profile.probedAt}`)
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
