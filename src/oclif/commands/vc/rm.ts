import {Command, Flags} from '@oclif/core'

import {type IVcRmRequest, type IVcRmResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcRm extends Command {
  public static description = 'Remove files from the working tree and the index'
  public static examples = [
    '<%= config.bin %> <%= command.id %> notes.md',
    '<%= config.bin %> <%= command.id %> --cached notes.md',
    '<%= config.bin %> <%= command.id %> -r design/',
    '<%= config.bin %> <%= command.id %> -n notes.md',
    '<%= config.bin %> <%= command.id %> --pathspec-from-file=paths.txt',
  ]
  public static flags = {
    cached: Flags.boolean({
      description: 'Only remove from the index; keep the working-tree file',
    }),
    'dry-run': Flags.boolean({
      char: 'n',
      description: 'Print what would be removed without changing anything',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Override the up-to-date check',
    }),
    'ignore-unmatch': Flags.boolean({
      description: 'Exit with zero status even when no files match',
    }),
    'pathspec-file-nul': Flags.boolean({
      dependsOn: ['pathspec-from-file'],
      description: 'With --pathspec-from-file, pathspec elements are separated with NUL',
    }),
    'pathspec-from-file': Flags.string({
      description: 'Read pathspec from <file>; one per line (or NUL with --pathspec-file-nul)',
    }),
    quiet: Flags.boolean({
      char: 'q',
      description: 'Suppress per-file output',
    }),
    recursive: Flags.boolean({
      char: 'r',
      description: 'Allow recursive removal of directories',
    }),
  }
  public static strict = false

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(VcRm)
    const filePaths = argv.filter((a): a is string => typeof a === 'string')

    const payload: IVcRmRequest = {
      cached: flags.cached ?? undefined,
      dryRun: flags['dry-run'] ?? undefined,
      filePaths,
      force: flags.force ?? undefined,
      ignoreUnmatch: flags['ignore-unmatch'] ?? undefined,
      pathspecFileNul: flags['pathspec-file-nul'] ?? undefined,
      pathspecFromFile: flags['pathspec-from-file'],
      quiet: flags.quiet ?? undefined,
      recursive: flags.recursive ?? undefined,
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcRmResponse>(VcEvents.RM, payload),
      )

      if (!flags.quiet) {
        for (const line of result.perFile) this.log(line)
        if (result.dryRun) {
          this.log(`Would remove ${result.filesRemoved} file(s).`)
        } else if (result.filesRemoved === 0) {
          this.log('Nothing to remove.')
        } else {
          this.log(`Removed ${result.filesRemoved} file(s).`)
        }
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
