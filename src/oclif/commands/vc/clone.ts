import {Args, Command, Flags} from '@oclif/core'

import {
  type IVcCloneProgressEvent,
  type IVcCloneResponse,
  VcEvents,
} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

function subscribeToProgress(client: {on: <T>(event: string, handler: (data: T) => void) => () => void}): {
  cleanup: () => void
} {
  let lastWasProgress = false
  const unsub = client.on<IVcCloneProgressEvent>(VcEvents.CLONE_PROGRESS, (evt: IVcCloneProgressEvent) => {
    const isGitProgress = evt.step === 'cloning' && /^\w[\w\s]*: \d/.test(evt.message)
    if (isGitProgress) {
      process.stderr.write(`\r\u001B[K${evt.message}`)
      lastWasProgress = true
    } else {
      if (lastWasProgress) process.stderr.write('\n')
      process.stderr.write(`${evt.message}\n`)
      lastWasProgress = false
    }
  })

  return {
    cleanup() {
      if (lastWasProgress) process.stderr.write('\n')
      unsub()
    },
  }
}

export default class VcClone extends Command {
  public static args = {
    url: Args.string({description: 'Clone URL (e.g. https://byterover.dev/team/space.brv)'}),
  }
  public static description = 'Clone a ByteRover space repository'
  public static examples = [
    '<%= config.bin %> vc clone https://byterover.dev/acme/project.brv',
    '<%= config.bin %> vc clone https://cogit.byterover.dev/git/teamId/spaceId.git',
    '<%= config.bin %> vc clone --team acme --space my-space',
  ]
  public static flags = {
    space: Flags.string({
      char: 's',
      description: 'Name of the space to clone',
    }),
    team: Flags.string({
      char: 't',
      description: 'Team name',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(VcClone)

    // Resolve URL from args or flags
    let {url} = args
    if (!url && flags.team && flags.space) {
      url = `https://byterover.dev/${flags.team}/${flags.space}.brv`
    }

    if (!url) {
      this.error(
        'Provide a URL or use --team and --space flags.\n' +
          'Usage: brv vc clone <url>\n' +
          '       brv vc clone --team <team> --space <space>',
      )
    }

    try {
      const result = await withDaemonRetry(async (client) => {
        const {cleanup} = subscribeToProgress(client)
        try {
          return await client.requestWithAck<IVcCloneResponse>(VcEvents.CLONE, {url}, {timeout: 120_000})
        } finally {
          cleanup()
        }
      })

      const label = result.teamName && result.spaceName ? `${result.teamName}/${result.spaceName}` : 'repository'
      this.log(`Cloned ${label} successfully.`)
      this.log(`Git dir: ${result.gitDir}`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
