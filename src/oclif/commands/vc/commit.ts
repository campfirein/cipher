import {input} from '@inquirer/prompts'
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

    await this.runCommit(message, sign)
  }

  private async runCommit(message: string, sign: boolean | undefined, passphrase?: string, attempt: number = 0): Promise<void> {
    const payload: IVcCommitRequest = {message, ...(sign === undefined ? {} : {sign}), ...(passphrase ? {passphrase} : {})}

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcCommitResponse>(VcEvents.COMMIT, payload),
      )

      const sigIndicator = sign === true ? ' 🔏' : ''
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

        let pp: string
        try {
          pp = await input({
            message: 'Enter SSH key passphrase:',
            // @ts-expect-error — inquirer types vary; hide input for passwords
            type: 'password',
          })
        } catch {
          this.error('Passphrase input cancelled.')
        }

        await this.runCommit(message, sign, pp!, attempt + 1)
        return
      }

      this.error(formatConnectionError(error))
    }
  }
}
