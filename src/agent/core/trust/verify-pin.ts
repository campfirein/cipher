/* eslint-disable camelcase */
// TOFU KnownPeer wire fields use snake_case to match the on-disk
// schema (AMENDMENT_TOFU §A3.2). Disabled at file scope.

import type {KnownPeer, TofuStore} from './tofu-store.js'

/**
 * Phase 9 / Slice 9.4g — promote a TOFU-pinned peer from
 * `auto-tofu` → `user-confirmed`.
 *
 * Background: the spec §7.3 auto-provision policy defaults to
 * `pinned-only`, which rejects inbound parley queries from senders in
 * `pin_state: 'auto-tofu'`. Operators see the resulting
 * `CHANNEL_AUTO_PROVISION_DECLINED` error on Alice's side and need a
 * way to promote the peer after eyeballing the fingerprint. This
 * helper IS that promotion — it does not re-dial, re-fetch, or
 * re-verify the install cert (the existing pin already did all that);
 * it only moves the `pin_state` enum.
 *
 * Idempotent:
 *   - `auto-tofu`     → flips to `user-confirmed` and returns the new record
 *   - `user-confirmed` → returns the existing record unchanged
 *   - `ca-bound`      → returns the existing record unchanged. `ca-bound` is
 *                       strictly stronger than `user-confirmed` in the
 *                       trust ordering — re-flipping the enum would be a
 *                       downgrade.
 *
 * Throws `VerifyPinError(PEER_NOT_PINNED)` when the peer is not in
 * the TOFU store. The caller should suggest `brv bridge pin` first.
 */

export class VerifyPinError extends Error {
  public readonly code: 'PEER_NOT_PINNED'

  public constructor(code: 'PEER_NOT_PINNED', message: string) {
    super(message)
    this.code = code
    this.name = 'VerifyPinError'
  }
}

export type VerifyPinArgs = {
  readonly peerId: string
  readonly tofu: TofuStore
}

export async function verifyPin(args: VerifyPinArgs): Promise<KnownPeer> {
  return args.tofu.upsertWithMerge(args.peerId, (existing) => {
    if (existing === undefined) {
      throw new VerifyPinError(
        'PEER_NOT_PINNED',
        `peer ${args.peerId} is not in the TOFU store — run \`brv bridge pin <multiaddr>\` first`,
      )
    }

    // ca-bound is strictly stronger than user-confirmed: a CA log
    // entry has corroborated the peer's identity beyond the local
    // operator's eyeball check. Don't downgrade.
    if (existing.pin_state === 'ca-bound') return existing
    if (existing.pin_state === 'user-confirmed') return existing
    return {...existing, pin_state: 'user-confirmed'}
  })
}
