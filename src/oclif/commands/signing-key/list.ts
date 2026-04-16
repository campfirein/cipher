import {Command} from '@oclif/core'

import {type IVcSigningKeyResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class SigningKeyList extends Command {
  public static description = 'List SSH signing keys registered on your Byterover account'
  public static examples = ['<%= config.bin %> <%= command.id %>']

  public async run(): Promise<void> {
    try {
      const response = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcSigningKeyResponse>(VcEvents.SIGNING_KEY, {action: 'list'}),
      )

      if (response.action !== 'list' || !response.keys) {
        this.error('Unexpected response from daemon')
      }

      const {keys} = response

      if (keys.length === 0) {
        this.log('No signing keys registered.')
        this.log('  Run: brv signing-key add --key ~/.ssh/id_ed25519')
        return
      }

      this.log(`\nSigning keys (${keys.length}):\n`)
      for (const key of keys) {
        const lastUsed = key.lastUsedAt
          ? `Last used: ${new Date(key.lastUsedAt).toLocaleDateString()}`
          : 'Never used'
        this.log(`  [${key.id}]`)
        this.log(`    Title:       ${key.title}`)
        this.log(`    Fingerprint: ${key.fingerprint}`)
        this.log(`    Type:        ${key.keyType}`)
        this.log(`    ${lastUsed}`)
        this.log(`    Added:       ${new Date(key.createdAt).toLocaleDateString()}`)
        this.log('')
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
