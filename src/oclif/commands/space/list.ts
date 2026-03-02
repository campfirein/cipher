import {Command, Flags} from '@oclif/core'

import {SpaceEvents, type SpaceListResponse} from '../../../shared/transport/events/space-events.js'
import {type DaemonClientOptions, formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'
import {writeJsonResponse} from '../../lib/json-response.js'

export default class SpaceList extends Command {
  public static description = 'List all teams and spaces'
  public static examples = ['<%= config.bin %> space list', '<%= config.bin %> space list --format json']
  public static flags = {
    format: Flags.string({
      char: 'f',
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  protected async fetchSpaces(options?: DaemonClientOptions): Promise<SpaceListResponse> {
    return withDaemonRetry<SpaceListResponse>(
      async (client) => client.requestWithAck<SpaceListResponse>(SpaceEvents.LIST),
      options,
    )
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(SpaceList)
    const format = flags.format as 'json' | 'text'

    try {
      const {teams} = await this.fetchSpaces()

      if (format === 'json') {
        const data = {
          teams: teams.map((t) => ({
            teamId: t.teamId,
            teamName: t.teamName,
            // eslint-disable-next-line perfectionist/sort-objects
            spaces: t.spaces.map((s) => ({
              isDefault: s.isDefault,
              spaceId: s.id,
              spaceName: s.name,
            })),
          })),
        }
        writeJsonResponse({command: 'space list', data, success: true})
        return
      }

      if (teams.length === 0) {
        this.log('No teams found.')
        return
      }

      for (const [index, team] of teams.entries()) {
        this.log(`${index + 1}. ${team.teamName} (team)`)
        if (team.spaces.length === 0) {
          this.log('   No spaces')
        } else {
          for (const space of team.spaces) {
            const defaultMarker = space.isDefault ? ' (default)' : ''
            this.log(`   - ${space.name}${defaultMarker} (space)`)
          }
        }
      }
    } catch (error) {
      if (format === 'json') {
        writeJsonResponse({command: 'space list', data: {error: formatConnectionError(error)}, success: false})
      } else {
        this.log(formatConnectionError(error))
      }
    }
  }
}
