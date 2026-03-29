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
  ]
  public static flags = {
    hard: Flags.string({
      description: 'Reset HEAD, index, and working tree to the given ref',
      exclusive: ['soft'],
    }),
    soft: Flags.string({
      description: 'Reset HEAD only, keep changes staged',
      exclusive: ['hard'],
    }),
  }
  public static strict = false

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(VcReset)
    const filePaths = argv.filter((a): a is string => typeof a === 'string')

    try {
      if (filePaths.length > 0) {
        const result = await withDaemonRetry(async (client) =>
          client.requestWithAck<IVcResetResponse>(VcEvents.RESET, {filePaths}),
        )
        this.formatUnstageResult(result)
      } else if (flags.soft) {
        const result = await withDaemonRetry(async (client) =>
          client.requestWithAck<IVcResetResponse>(VcEvents.RESET, {mode: 'soft', ref: flags.soft}),
        )
        this.formatRefResult(result)
      } else if (flags.hard) {
        const result = await withDaemonRetry(async (client) =>
          client.requestWithAck<IVcResetResponse>(VcEvents.RESET, {mode: 'hard', ref: flags.hard}),
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
    const sha = result.headSha ? result.headSha.slice(0, 7) : 'unknown'
    this.log(`HEAD is now at ${sha}`)
  }

  private formatUnstageResult(result: IVcResetResponse): void {
    if (result.filesUnstaged === 0) {
      this.log('Nothing to unstage.')
    } else {
      this.log(`Unstaged ${result.filesUnstaged} file(s).`)
    }
  }
}
