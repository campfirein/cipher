import {password} from '@inquirer/prompts'
import {Command, Flags} from '@oclif/core'

import {type IVcCommitRequest, type IVcCommitResponse, VcErrorCode, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcCommit extends Command {
  public static description = 'Save staged changes as a commit'
  public static examples = [
    '<%= config.bin %> <%= command.id %> -m "Add project architecture notes"',
    '<%= config.bin %> <%= command.id %> -m "Signed commit" --sign',
    '<%= config.bin %> <%= command.id %> -m "Unsigned commit" --no-sign',
  ]
public static flags = {
    message: Flags.string({
      char: 'm',
      description: 'Commit message',
    }),
    passphrase: Flags.string({
      description: 'SSH key passphrase (prefer BRV_SSH_PASSPHRASE env var)',
    }),
    sign: Flags.boolean({
      allowNo: true,
      description: 'Sign the commit with your configured SSH key. Use --no-sign to override commit.sign=true.',
    }),
  }
private static readonly MAX_PASSPHRASE_RETRIES = 3
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
    const pp = flags.passphrase ?? process.env.BRV_SSH_PASSPHRASE

    await this.runCommit(message, sign, pp)
  }

  private async runCommit(message: string, sign: boolean | undefined, passphrase?: string, attempt: number = 0): Promise<void> {
    const payload: IVcCommitRequest = {message, ...(sign === undefined ? {} : {sign}), ...(passphrase ? {passphrase} : {})}

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcCommitResponse>(VcEvents.COMMIT, payload),
      )

      const sigIndicator = result.signed ? ' 🔏' : ''
      this.log(`[${result.sha.slice(0, 7)}] ${result.message}${sigIndicator}`)
    } catch (error) {
      // Passphrase required — prompt and retry (capped)
      if (
        error instanceof Error &&
        'code' in error &&
        (error as {code: string}).code === VcErrorCode.PASSPHRASE_REQUIRED
      ) {
        if (attempt >= VcCommit.MAX_PASSPHRASE_RETRIES) {
          this.error(`Too many failed passphrase attempts (${VcCommit.MAX_PASSPHRASE_RETRIES}).`)
        }

        if (!process.stdin.isTTY) {
          this.error('Passphrase required but no TTY available. Set BRV_SSH_PASSPHRASE env var or use --passphrase flag.')
        }

        let pp: string
        try {
          pp = await password({
            message: 'Enter SSH key passphrase:',
          })
        } catch {
          this.error('Passphrase input cancelled.')
        }

        await this.runCommit(message, sign, pp, attempt + 1)
        return
      }

      this.error(formatConnectionError(error))
    }
  }
}
