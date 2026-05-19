import {Args, Command, Flags} from '@oclif/core'
import {join} from 'node:path'

import {TofuStore} from '../../../agent/core/trust/tofu-store.js'
import {verifyPin, VerifyPinError} from '../../../agent/core/trust/verify-pin.js'
import {getGlobalDataDir} from '../../../server/utils/global-data-path.js'

/**
 * Phase 9 / Slice 9.4g — `brv bridge verify <peer-id>`.
 *
 * Promote an already-pinned peer from `auto-tofu` to `user-confirmed`
 * so the default `pinned-only` auto-provision policy (spec §7.3)
 * accepts inbound parley queries from that peer. Run this AFTER
 * `brv bridge pin <multiaddr>` once you have eyeballed the fingerprint
 * (compared out-of-band with the remote operator).
 *
 * Idempotent: re-running on a `user-confirmed` or `ca-bound` peer is
 * a no-op success that prints the current pin state.
 */
export default class BridgeVerify extends Command {
  public static args = {
    'peer-id': Args.string({
      description: 'libp2p peer_id of the previously-pinned peer (12D3Koo… base58btc form)',
      required: true,
    }),
  }
public static description = 'Promote a pinned peer from auto-tofu to user-confirmed (after eyeballing the fingerprint)'
public static examples = [
    '<%= config.bin %> <%= command.id %> 12D3KooWAlice…',
    '<%= config.bin %> <%= command.id %> 12D3KooWAlice… --format json',
  ]
public static flags = {
    format: Flags.string({
      default: 'text',
      description: 'Output format',
      options: ['text', 'json'],
    }),
  }

  public async run(): Promise<void> {
    const {args, flags} = await this.parse(BridgeVerify)

    const peerId = args['peer-id']
    const tofuPath = join(getGlobalDataDir(), 'identity', 'known-peers.jsonl')
    const tofu = new TofuStore({storePath: tofuPath})

    try {
      const peer = await verifyPin({peerId, tofu})

      if (flags.format === 'json') {
        this.log(JSON.stringify({data: peer, ok: true}))
        return
      }

      this.log('verified:')
      this.log(`  peer_id:                    ${peer.peer_id}`)
      this.log(`  install_cert_fingerprint:   ${peer.install_cert_fingerprint}`)
      this.log(`  pin_state:                  ${peer.pin_state}`)
      if (peer.display_handle !== undefined) {
        this.log(`  display_handle:             ${peer.display_handle}`)
      }

      this.log(
        '\nThis peer can now mention this install on channels with the default `pinned-only`\n' +
          'auto-provision policy (spec §7.3).',
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const code = error instanceof VerifyPinError ? error.code : 'BRIDGE_VERIFY_FAILED'
      if (flags.format === 'json') {
        this.log(JSON.stringify({code, error: msg, ok: false}))
      } else {
        this.error(msg, {exit: 1})
      }
    }
  }
}
