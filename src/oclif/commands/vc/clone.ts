import {Args, Command} from '@oclif/core'

import {InitEvents, type InitLocalResponse} from '../../../shared/transport/events/init-events.js'
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
    url: Args.string({description: 'Clone URL (e.g. https://app.byterover.dev/team/space.brv)'}),
  }
  public static description = 'Clone a ByteRover space repository'
  public static examples = ['<%= config.bin %> vc clone https://app.byterover.dev/acme/project.brv']

  public async run(): Promise<void> {
    const {args} = await this.parse(VcClone)
    const {url} = args

    if (!url) {
      // eslint-disable-next-line no-useless-concat
      this.error('URL is required.\n' + 'Usage: brv vc clone <url>')
    }

    const daemonOptions = {projectPath: process.cwd()}

    try {
      // Ensure .brv/config.json exists so the daemon registers this cwd as the project root
      await withDaemonRetry(
        async (client) => client.requestWithAck<InitLocalResponse>(InitEvents.LOCAL, {}),
        daemonOptions,
      )

      const result = await withDaemonRetry(async (client) => {
        const {cleanup} = subscribeToProgress(client)
        try {
          return await client.requestWithAck<IVcCloneResponse>(VcEvents.CLONE, {url}, {timeout: 120_000})
        } finally {
          cleanup()
        }
      }, daemonOptions)

      const label = result.teamName && result.spaceName ? `${result.teamName}/${result.spaceName}` : 'repository'
      this.log(`Cloned ${label} successfully.`)
      this.log(`Git dir: ${result.gitDir}`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
