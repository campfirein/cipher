import {Command, Flags} from '@oclif/core'

import {SpaceEvents, type SpaceListResponse} from '../../../shared/transport/events/space-events.js'
import {type IVcCloneResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcClone extends Command {
  public static description = 'Clone a ByteRover space repository'
  public static examples = ['<%= config.bin %> vc clone --team acme --space my-space']
  public static flags = {
    space: Flags.string({
      char: 's',
      description: 'Name of the space to clone',
      required: true,
    }),
    team: Flags.string({
      char: 't',
      description: 'Team name',
      required: true,
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(VcClone)
    const spaceName = flags.space
    const teamName = flags.team

    try {
      const result = await withDaemonRetry(async (client) => {
        const {teams} = await client.requestWithAck<SpaceListResponse>(SpaceEvents.LIST)
        const team = teams.find((t) => t.teamName === teamName)

        if (!team) {
          const available = teams.map((t) => t.teamName).join(', ')
          throw new Error(
            teams.length > 0
              ? `Team "${teamName}" not found. Available teams: ${available}`
              : `Team "${teamName}" not found. No teams available.`,
          )
        }

        const targetSpace = team.spaces.find((s) => s.name === spaceName)
        if (!targetSpace) {
          const available = team.spaces.map((s) => s.name).join(', ')
          throw new Error(
            team.spaces.length > 0
              ? `Space "${spaceName}" not found in team "${teamName}". Available spaces: ${available}`
              : `Space "${spaceName}" not found in team "${teamName}". No spaces available.`,
          )
        }

        return client.requestWithAck<IVcCloneResponse>(VcEvents.CLONE, {
          spaceId: targetSpace.id,
          spaceName: targetSpace.name,
          teamId: targetSpace.teamId,
          teamName: targetSpace.teamName,
        })
      })

      this.log(`Cloned ${result.teamName}/${result.spaceName} successfully.`)
      this.log(`Git dir: ${result.gitDir}`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
