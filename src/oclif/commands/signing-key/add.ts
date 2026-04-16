import {Command, Flags} from '@oclif/core'
import {readFileSync} from 'node:fs'

import {parseSSHPrivateKey, resolveHome} from '../../../server/infra/ssh/index.js'
import {type IVcSigningKeyResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class SigningKeyAdd extends Command {
  public static description = 'Add an SSH public key to your Byterover account for commit signing'
  public static examples = [
    '<%= config.bin %> <%= command.id %> --key ~/.ssh/id_ed25519 --title "Dev laptop"',
    '<%= config.bin %> <%= command.id %> -k ~/.ssh/id_ed25519.pub',
  ]
public static flags = {
    key: Flags.string({
      char: 'k',
      description:
        'Path to the SSH private key (used to derive the public key) or a .pub file',
      required: true,
    }),
    title: Flags.string({
      char: 't',
      description: 'Human-readable label for the key (defaults to the key comment)',
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(SigningKeyAdd)
    const keyPath = resolveHome(flags.key)

    let publicKey: string
    let {title} = flags

    try {
      if (keyPath.endsWith('.pub')) {
        // Public key file — read directly
        const raw = readFileSync(keyPath, 'utf8').trim()
        publicKey = raw
        // Extract comment as default title (third field in authorized_keys format)
        const parts = raw.split(' ')
        if (!title && parts.length >= 3) title = parts.slice(2).join(' ')
      } else {
        // Private key file — parse to derive public key
        const parsed = await parseSSHPrivateKey(keyPath)
        // Re-export public key in SSH authorized_keys format: type b64(blob) [comment]
        const b64 = parsed.publicKeyBlob.toString('base64')
        publicKey = `${parsed.keyType} ${b64}`
        if (!title) title = `My ${parsed.keyType} key`
      }
    } catch (error) {
      this.error(
        `Failed to read key file: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (!title) title = 'My SSH key'

    try {
      const response = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcSigningKeyResponse>(VcEvents.SIGNING_KEY, {
          action: 'add',
          publicKey: publicKey!,
          title,
        }),
      )

      if (response.action === 'add' && response.key) {
        this.log('✅ Signing key added successfully')
        this.log(`   Title:       ${response.key.title}`)
        this.log(`   Fingerprint: ${response.key.fingerprint}`)
        this.log(`   Type:        ${response.key.keyType}`)
      }
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }
}
