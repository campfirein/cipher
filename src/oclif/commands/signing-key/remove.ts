import {Args, Command} from '@oclif/core'

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
    '<%= config.bin %> <%= command.id %> <key-id>',
    '# Get key ID from: brv signing-key list',
  ]

  public async run(): Promise<void> {
    const {args} = await this.parse(SigningKeyRemove)

    try {
      await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcSigningKeyResponse>(VcEvents.SIGNING_KEY, {
          action: 'remove',
          keyId: args.id,
        }),
      )

      this.log(`✅ Signing key removed: ${args.id}`)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
