import {Command, Flags} from '@oclif/core'
import open from 'open'

import {formatConnectionError, withDaemonRetry} from '../lib/daemon-client.js'

export default class Webui extends Command {
  public static description = 'Open the web UI in the browser'
  public static examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --port 8080']
  public static flags = {
    port: Flags.integer({
      char: 'p',
      description: 'Set the web UI port (remembered for future use)',
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Webui)

    let webuiPort: number

    try {
      // If --port is provided, tell the daemon to switch to that port and persist it
      if (flags.port) {
        const result = await withDaemonRetry(
          async (client) =>
            client.requestWithAck<{port: number; success: boolean}>('webui:setPort', {port: flags.port}),
          {projectPath: process.cwd()},
        )
        webuiPort = result.port
      } else {
        const result = await withDaemonRetry(
          async (client) => client.requestWithAck<{port?: number}>('webui:getPort'),
          {projectPath: process.cwd()},
        )

        if (!result.port) {
          this.error('Failed to get web UI port. Use `brv restart` to restart the daemon and try again')
        }

        webuiPort = result.port
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }

    const url = `http://localhost:${webuiPort}`
    this.log(`ByteRover Web UI: ${url}`)

    await open(url).catch(() => {
      this.log('Could not open browser automatically. Open the URL above manually.')
    })
  }
}
