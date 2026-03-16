import {discoverDaemon, ensureDaemonRunning} from '@campfirein/brv-transport-client'
import {Command} from '@oclif/core'
import open from 'open'

import {resolveLocalServerMainPath} from '../../server/utils/server-main-resolver.js'

export default class Webui extends Command {
  public static description = 'Open the web UI in the browser'
  public static examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    const daemonResult = await ensureDaemonRunning({
      serverPath: resolveLocalServerMainPath(),
      version: this.config.version,
    })

    if (!daemonResult.success) {
      const detail = daemonResult.spawnError ? `: ${daemonResult.spawnError}` : ''
      this.error(
        `Failed to start daemon${detail}\n\nRun 'brv restart' to force a clean restart.`,
      )
    }

    const status = discoverDaemon()
    if (!status.running) {
      this.error('Daemon is not running. Run "brv restart" to start it.')
    }

    const url = `http://localhost:${status.port}/ui`
    this.log(`ByteRover Web UI: ${url}`)

    await open(url).catch(() => {
      this.log('Could not open browser automatically. Open the URL above manually.')
    })
  }
}
