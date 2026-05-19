import * as lp from 'it-length-prefixed'

import {InstallIdentityService} from '../../../../agent/core/trust/install-identity-service.js'
import {type Libp2pHost} from './libp2p-host.js'

/**
 * Phase 9 / Slice 9.2 — identity exchange protocol (server side).
 *
 * Registers a handler for `/brv/identity/cert/v1` that streams this
 * install's `InstallCertificate` JSON as a single length-prefixed
 * varint frame, then returns (does NOT close the stream — the
 * dialer closes after reading).
 *
 * Wire shape: one direction (server → client) — server writes a
 * varint-length-prefixed frame containing the canonical JSON of
 * `install.cert.json`. No request body, no negotiation. The
 * brv-channel-skill "Read the file yourself" convention applies: the
 * caller validates the cert per AMENDMENT_TOFU §A3.2 before trusting
 * any byte of it.
 *
 * Stream-close semantics (libp2p quirk worth pinning):
 * Calling `stream.close()` or `stream.closeWrite()` server-side BEFORE
 * the dialer's multistream-select handshake has fully drained on the
 * other end produces `StreamStateError: Cannot push data onto a stream
 * that is closed` (the dialer's protocol-ACK byte arrives at a
 * stream that's already been torn down). The robust pattern is:
 *   1. Server: send length-prefixed payload, RETURN from handler
 *      (do NOT close).
 *   2. Client: read one length-prefixed frame, then close().
 *
 * Phase 9 Slice 9.3 Parley handshake SUPERSEDES this for routine
 * cert exchange (the handshake includes the install cert in its own
 * envelope). This dedicated identity-fetch protocol exists for the
 * out-of-band `brv trust pin --multiaddr` flow — peer_id + multiaddr
 * are known but there's no Parley turn yet.
 */

export const IDENTITY_PROTOCOL = '/brv/identity/cert/v1'

export interface RegisterIdentityServerDeps {
  readonly host: Libp2pHost
  readonly identity: InstallIdentityService
}

/**
 * Register the `/brv/identity/cert/v1` stream handler on the given
 * Libp2pHost. Call this once during daemon startup AFTER the host
 * has started.
 */
export async function registerIdentityServer(deps: RegisterIdentityServerDeps): Promise<void> {
  await deps.host.handle(IDENTITY_PROTOCOL, async (stream) => {
    const identity = await deps.identity.loadOrGenerate()
    const json = JSON.stringify(identity.cert)
    const payload = new TextEncoder().encode(json)

    // Length-prefix the frame so the dialer knows the exact byte count
    // without relying on stream-close as the end-of-message signal.
    const framed = await encodeLengthPrefixed(payload)
    await stream.send(framed)
    // Intentionally do NOT call stream.close() — see file-level comment.
  })
}

/** Encode a Uint8Array as a single varint-length-prefixed frame. */
async function encodeLengthPrefixed(bytes: Uint8Array): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const buf of lp.encode([bytes])) {
    chunks.push(buf.subarray())
  }

  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }

  return out
}
