import {Command, Flags} from '@oclif/core'

import {
  SpaceEvents,
  type SpaceListResponse,
  type SpaceSwitchResponse,
} from '../../../shared/transport/events/space-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class SpaceSwitch extends Command {
  public static description = 'Switch to a different space'
  public static examples = [
    '<%= config.bin %> space switch --team acme --name my-space',
    '<%= config.bin %> space switch --team acme --name my-space --format json',
  ]
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
    name: Flags.string({
      char: 'n',
      description: 'Name of the space to switch to',
      required: true,
    }),
    team: Flags.string({
      char: 't',
      description: 'Team name',
      required: true,
    }),
  }

  protected async executeSwitch(
    params: {spaceName: string; teamName: string},
    options?: DaemonClientOptions,
  ): Promise<SpaceSwitchResponse> {
    return withDaemonRetry<SpaceSwitchResponse>(async (client) => {
      const {teams} = await client.requestWithAck<SpaceListResponse>(SpaceEvents.LIST)
      const team = teams.find((t) => t.teamName === params.teamName)

      if (!team) {
        const available = teams.map((t) => t.teamName).join(', ')
        throw new Error(
          teams.length > 0
            ? `Team "${params.teamName}" not found. Available teams: ${available}`
            : `Team "${params.teamName}" not found. No teams available.`,
        )
      }

      const targetSpace = team.spaces.find((s) => s.name === params.spaceName)
      if (!targetSpace) {
        const available = team.spaces.map((s) => s.name).join(', ')
        throw new Error(
          team.spaces.length > 0
            ? `Space "${params.spaceName}" not found in team "${params.teamName}". Available spaces: ${available}`
            : `Space "${params.spaceName}" not found in team "${params.teamName}". No spaces available.`,
        )
      }

      return client.requestWithAck<SpaceSwitchResponse>(SpaceEvents.SWITCH, {spaceId: targetSpace.id})
    }, options)
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(SpaceSwitch)
    const format = flags.format as 'json' | 'text'
    const spaceName = flags.name
    const teamName = flags.team

    try {
      const result = await this.executeSwitch({spaceName, teamName})

      if (format === 'json') {
        writeJsonResponse({command: 'space switch', data: result, success: true})
      } else {
        this.log(`Successfully switched to space: ${result.config.spaceName}`)
        if (result.pullResult) {
          this.log(
            `Pulled: +${result.pullResult.added} ~${result.pullResult.edited} -${result.pullResult.deleted}`,
          )
        } else if (result.pullError) {
          this.log(`Pull skipped: ${result.pullError}`)
        }

        this.log('Configuration updated in: .brv/config.json')
      }
    } catch (error) {
      if (format === 'json') {
        const errorMessage = error instanceof Error ? error.message : 'Switch failed'
        writeJsonResponse({command: 'space switch', data: {error: errorMessage}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
