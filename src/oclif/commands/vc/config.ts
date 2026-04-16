import {Args, Command, Flags} from '@oclif/core'
import {existsSync, readFileSync} from 'node:fs'

import {extractPublicKey, resolveHome} from '../../../shared/ssh/index.js'
import {isVcConfigKey, type IVcConfigResponse, type IVcSigningKeyResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
import {formatConnectionError, withDaemonRetry} from '../../lib/daemon-client.js'

export default class VcConfig extends Command {
  public static args = {
    key: Args.string({
      description: 'Config key: user.name, user.email, user.signingkey, commit.sign',
      required: false,
    }),
    value: Args.string({description: 'Value to set (omit to read current value)'}),
  }
public static description = 'Get or set commit author / signing config for ByteRover version control'
public static examples = [
    '<%= config.bin %> <%= command.id %> user.name "Your Name"',
    '<%= config.bin %> <%= command.id %> user.email "you@example.com"',
    '<%= config.bin %> <%= command.id %> user.signingkey ~/.ssh/id_ed25519',
    '<%= config.bin %> <%= command.id %> commit.sign true',
    '<%= config.bin %> <%= command.id %> user.name',
    '<%= config.bin %> <%= command.id %> --import-git-signing',
  ]
public static flags = {
    'import-git-signing': Flags.boolean({
      description:
        'Import SSH signing config from local or global git config ' +
        '(user.signingKey + gpg.format=ssh + commit.gpgSign)',
      exclusive: ['key'],
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(VcConfig)
    const {key, value} = args

    // --import-git-signing mode: reads local/global gitconfig and imports into brv config
    if (flags['import-git-signing']) {
      await this.runImport()
      return
    }

    if (!key) {
      this.error(
        'Usage: brv vc config <key> [value]\n' +
        'Keys: user.name, user.email, user.signingkey, commit.sign\n' +
        'Or: brv vc config --import-git-signing',
      )
    }

    if (!isVcConfigKey(key)) {
      this.error(
        `Unknown key '${key}'. Allowed: user.name, user.email, user.signingkey, commit.sign.`,
      )
    }

    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcConfigResponse>(VcEvents.CONFIG, {key, value}),
      )

      if (result.hint) this.log(`  Hint: ${result.hint}`)
      this.log(result.value)
    } catch (error) {
      this.error(formatConnectionError(error))
    }
  }

  /**
   * Import SSH signing configuration from the local or global git config.
   * Reads: user.signingKey, gpg.format, commit.gpgSign via `git config --get`
   */
  private async runImport(): Promise<void> {
    try {
      const result = await withDaemonRetry(async (client) =>
        client.requestWithAck<IVcConfigResponse>(VcEvents.CONFIG, {importGitSigning: true}),
      )

      if (result.hint) this.log(`  ${result.hint}`)
      this.log(`✅ Imported signing config from git:`)
      this.log(`   user.signingkey = ${result.value}`)

      // Attempt to register the key automatically
      this.log(`\n⏳ Attempting to register signing key with ByteRover server...`)
      try {
        const keyPath = resolveHome(result.value)
        let publicKey: string
        let title = 'My SSH key'

        const pubPath = keyPath.endsWith('.pub') ? keyPath : `${keyPath}.pub`

        if (existsSync(pubPath)) {
          const raw = readFileSync(pubPath, 'utf8').trim()
          publicKey = raw
          const parts = raw.split(' ')
          if (parts.length >= 3) title = parts.slice(2).join(' ')
        } else {
          // No .pub sidecar — extract public key without decryption (works for encrypted keys)
          const extracted = await extractPublicKey(keyPath)
          const b64 = extracted.publicKeyBlob.toString('base64')
          publicKey = `${extracted.keyType} ${b64}`
          title = extracted.comment ?? `My ${extracted.keyType} key`
        }

        const response = await withDaemonRetry(async (client) =>
          client.requestWithAck<IVcSigningKeyResponse>(VcEvents.SIGNING_KEY, {
            action: 'add',
            publicKey,
            title,
          }),
        )

        if (response.action === 'add' && response.key) {
          this.log('✅ Signing key registered successfully on server')
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        if (errMsg.includes('already exists') || errMsg.includes('Duplicate') || errMsg.includes('ALREADY_EXISTS') || errMsg.includes('409')) {
          this.log('✅ Signing key is already registered on server')
        } else {
          this.log(`⚠️  Could not automatically register key: ${errMsg}`)
          this.log(`   You may need to run: brv signing-key add --key ${result.value}`)
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      // Provide helpful guidance when no signing key is configured in git
      if (msg.includes('not set') || msg.includes('not found')) {
        this.log('ℹ️  No SSH signing key found in your git config.')
        this.log('')
        this.log('To configure SSH signing in git:')
        this.log('  git config user.signingKey ~/.ssh/id_ed25519')
        this.log('  git config gpg.format ssh')
        this.log('  git config commit.gpgSign true')
        this.log('')
        this.log('Or set it directly in brv:')
        this.log('  brv vc config user.signingkey ~/.ssh/id_ed25519')
        this.log('  brv vc config commit.sign true')
        return
      }

      this.error(formatConnectionError(error))
    }
  }
}
