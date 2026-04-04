import {Command, Flags} from '@oclif/core'

import {type IVcResetResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcReset extends Command {
  public static description = 'Unstage files or undo commits'
  public static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> notes.md',
    '<%= config.bin %> <%= command.id %> --soft HEAD~1',
    '<%= config.bin %> <%= command.id %> --hard HEAD~1',
    '<%= config.bin %> <%= command.id %> --hard',
  ]
  public static flags = {
    hard: Flags.boolean({
      description: 'Reset HEAD, index, and working tree',
      exclusive: ['soft'],
    }),
    soft: Flags.boolean({
      description: 'Reset HEAD only, keep changes staged',
      exclusive: ['hard'],
    }),
  }
  public static strict = false

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(VcReset)
    const args = argv.filter((a): a is string => typeof a === 'string')

    // When --soft or --hard is set, first arg is the optional ref (default HEAD)
    const mode = flags.soft ? 'soft' : flags.hard ? 'hard' : undefined
    const ref = mode ? args[0] : undefined
    const filePaths = mode ? undefined : args.length > 0 ? args : undefined

    try {
      if (filePaths) {
        const result = await withDaemonRetry(async (client) =>
          client.requestWithAck<IVcResetResponse>(VcEvents.RESET, {filePaths}),
        )
        this.formatUnstageResult(result)
      } else if (mode) {
        const result = await withDaemonRetry(async (client) =>
          client.requestWithAck<IVcResetResponse>(VcEvents.RESET, {mode, ref}),
        )
        this.formatRefResult(result)
      } else {
        const result = await withDaemonRetry(async (client) =>
          client.requestWithAck<IVcResetResponse>(VcEvents.RESET, {}),
        )
        this.formatUnstageResult(result)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }

  private formatRefResult(result: IVcResetResponse): void {
    if (!result.headSha) return // Empty repo — silent no-op, matches git
    this.log(`HEAD is now at ${result.headSha.slice(0, 7)}`)
  }

  private formatUnstageResult(result: IVcResetResponse): void {
    if (result.filesUnstaged === 0) {
      this.log('Nothing to unstage.')
    } else {
      this.log(`Unstaged ${result.filesUnstaged} file(s).`)
    }
  }
}
