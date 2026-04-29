import {Args, Command, Flags} from '@oclif/core'

import {type IVcSigningKeyResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class SigningKeyRemove extends Command {
  public static args = {
    id: Args.string({
      description: 'Key ID to remove (from brv signing-key list)',
      required: true,
    }),
  }
  public static description = 'Remove an SSH signing key from your Byterover account'
  public static examples = [
    '<%= config.bin %> <%= command.id %> <key-id> --yes',
    '# Get key ID from: brv signing-key list',
  ]
  public static flags = {
    yes: Flags.boolean({
      default: false,
      description: 'Confirm the destructive removal (required — oclif commands never prompt).',
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(SigningKeyRemove)

    if (!flags.yes) {
      this.error(
        `Refusing to remove signing key '${args.id}' without explicit --yes confirmation. ` +
          'This action is irreversible. Re-run with --yes to proceed.',
      )
    }

    try {
      await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcSigningKeyResponse>(VcEvents.SIGNING_KEY, {
          action: 'remove',
          keyId: args.id,
        }),
      )

      this.log(`Signing key removed: ${args.id}`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
