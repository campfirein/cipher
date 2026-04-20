import {Command, Flags} from '@oclif/core'

import {type IVcCommitRequest, type IVcCommitResponse, VcErrorCode, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcCommit extends Command {
  public static description = 'Save staged changes as a commit'
  public static examples = [
    '<%= config.bin %> <%= command.id %> -m "Add project architecture notes"',
    '<%= config.bin %> <%= command.id %> -m "Signed commit" --sign',
    '<%= config.bin %> <%= command.id %> -m "Unsigned commit" --no-sign',
    '<%= config.bin %> <%= command.id %> -m "Signed (encrypted key)" --sign --passphrase "$MY_PASS"',
    'BRV_SSH_PASSPHRASE="$MY_PASS" <%= config.bin %> <%= command.id %> -m "Signed (env)" --sign',
  ]
  public static flags = {
    message: Flags.string({
      char: 'm',
      description: 'Commit message',
    }),
    passphrase: Flags.string({
      description: 'SSH key passphrase (or set BRV_SSH_PASSPHRASE env var)',
    }),
    sign: Flags.boolean({
      allowNo: true,
      description: 'Sign the commit with your configured SSH key. Use --no-sign to override commit.sign=true.',
    }),
  }
  public static strict = false

  public async run(): Promise<void> {
    const {argv, flags} = await this.parse(VcCommit)

    // Support unquoted multi-word messages: brv vc commit -m hello world
    const extra = (argv as string[]).join(' ')
    const message = flags.message
      ? (extra ? `${flags.message} ${extra}` : flags.message)
      : (extra || undefined)
    if (!message) {
      this.error('Usage: brv vc commit -m "<message>"')
    }

    const {sign} = flags
    const passphrase = flags.passphrase ?? process.env.BRV_SSH_PASSPHRASE
    const payload: IVcCommitRequest = {
      message,
      ...(sign === undefined ? {} : {sign}),
      ...(passphrase ? {passphrase} : {}),
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcCommitResponse>(VcEvents.COMMIT, payload),
      )

      const sigIndicator = result.signed ? ' 🔏' : ''
      this.log(`[${result.sha.slice(0, 7)}] ${result.message}${sigIndicator}`)
    } catch (error) {
      // oclif commands run non-interactively. Surface a clear actionable error
      // for missing passphrase instead of prompting — interactive entry belongs
      // in the TUI layer.
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code === VcErrorCode.PASSPHRASE_REQUIRED
      ) {
        this.error(
          'Signing key requires a passphrase. Provide it via the --passphrase flag ' +
            'or the BRV_SSH_PASSPHRASE environment variable, then retry.',
        )
      }

      this.error(formatConnectionError(error))
    }
  }
}
