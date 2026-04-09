import {Args, Command, Flags} from '@oclif/core'

import {isVcConfigKey, type IVcConfigResponse, VcEvents} from '../../../shared/transport/events/vc-events.js'
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
        client.requestWithAck<IVcConfigResponse>(VcEvents.CONFIG, {importGitSigning: true, key: 'user.signingkey'}),
      )

      if (result.hint) this.log(`  ${result.hint}`)
      this.log(`✅ Imported signing config from git:`)
      this.log(`   user.signingkey = ${result.value}`)
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
