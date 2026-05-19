/* eslint-disable camelcase */
// Cert payload fields mirror AMENDMENT_TOFU §A3.2 on-disk JSON shape.

import * as lp from 'it-length-prefixed'
import {createHash, createPublicKey} from 'node:crypto'

import {derivePeerIdFromRawPublicKey, isValidPeerIdString} from '../../../../agent/core/trust/peer-id.js'
import {verifyInstallCert} from '../../../../agent/core/trust/sign.js'
import {type KnownPeer, type TofuStore} from '../../../../agent/core/trust/tofu-store.js'
import {IDENTITY_PROTOCOL} from './identity-server.js'
import {type Libp2pHost} from './libp2p-host.js'

/**
 * Phase 9 / Slice 9.2 — identity exchange protocol (client side).
 *
 * `fetchAndPin` dials a remote multiaddr, reads the peer's
 * `InstallCertificate` via `/brv/identity/cert/v1`, runs the
 * AMENDMENT_TOFU §A3.2 verifier guards, and TOFU-pins the result to
 * the local `TofuStore`.
 *
 * Verifier guards run BEFORE any TOFU side effect (cheap → expensive
 * to fail-fast on common bad inputs):
 *   1. JSON parse succeeds (fetchCert)
 *   2. Strict shape match — no extra fields (validateCertShape)
 *   3. cert_kind === 'install'
 *   4. subject_id matches `expectedPeerId` (caller-supplied)
 *   5. issued_at <= now + clock_skew  ← time checks BEFORE crypto
 *   6. expires_at > now
 *   7. pubkey length === 32
 *   8. subject_id === derivePeerIdFromRawPublicKey(base64-decoded pubkey)
 *      (AMENDMENT_TOFU §A3.2 invariant)
 *   9. self-signature verifies (verifyInstallCert applies domain tag)
 *  10. handle-collision check vs other pinned peers (§A3.3 step 3)
 *
 * Only on ALL passing → upsert to TofuStore (under flock, with merge
 * inside the lock for race-free pin-state preservation).
 */

interface InstallCertificateOnWire {
  readonly cert_kind: 'install'
  readonly display_handle?: string
  readonly expires_at: string
  readonly issued_at: string
  readonly public_key: {alg: 'ed25519'; key: string}
  readonly signature: string
  readonly subject_id: string
  readonly version: 1
}

const KNOWN_CERT_FIELDS = new Set([
  'cert_kind',
  'display_handle',
  'expires_at',
  'issued_at',
  'public_key',
  'signature',
  'subject_id',
  'version',
])

const KNOWN_PUBKEY_FIELDS = new Set(['alg', 'key'])

export interface FetchAndPinArgs {
  readonly clockSkewMs?: number
  readonly expectedPeerId: string
  readonly host: Libp2pHost
  readonly multiaddr: string
  readonly now?: () => Date
  readonly tofuStore: TofuStore
}

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000  // 5 minutes per AMENDMENT_TOFU §5.1

export async function fetchAndPin(args: FetchAndPinArgs): Promise<KnownPeer> {
  if (!isValidPeerIdString(args.expectedPeerId)) {
    throw new Error(`PEER_ID_INVALID: expectedPeerId "${args.expectedPeerId}" is not a valid Ed25519 peer_id`)
  }

  const cert = await fetchCert(args.host, args.multiaddr)
  const now = (args.now ?? (() => new Date()))()
  const clockSkewMs = args.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS

  validateCertShape(cert)
  await validateCertGuards(cert, args.expectedPeerId, now, clockSkewMs)
  await assertNoHandleCollision(args.tofuStore, cert)

  // All guards passed — pin under the store's exclusive lock so that
  // pin_state / first_seen_at / ca_binding from a concurrent
  // user-confirmation upgrade cannot be silently overwritten by our
  // pre-lock snapshot (kimi round-1 MEDIUM — TOCTOU race fix).
  const fingerprint = pubkeyFingerprint(cert)
  const nowIso = now.toISOString()
  return args.tofuStore.upsertWithMerge(cert.subject_id, (existing) => ({
    display_handle: cert.display_handle,
    first_seen_at: existing?.first_seen_at ?? nowIso,
    install_cert_fingerprint: fingerprint,
    last_seen_at: nowIso,
    peer_id: cert.subject_id,
    pin_state: existing?.pin_state ?? 'auto-tofu',
    ...(existing?.ca_binding ? {ca_binding: existing.ca_binding} : {}),
  }))
}

// ─── internals ──────────────────────────────────────────────────────────────

async function fetchCert(host: Libp2pHost, multiaddrStr: string): Promise<unknown> {
  return host.dialAndConsume(multiaddrStr, IDENTITY_PROTOCOL, async (source) => {
    // lp.decode has two overloads — Iterable→Generator (sync), and
    // Source/AsyncIterable→AsyncGenerator. Cast to AsyncIterable so
    // TS picks the second overload and we pull a single frame.
    const asyncSource = source as AsyncIterable<Uint8Array>
    const iter = lp.decode(asyncSource)[Symbol.asyncIterator]()
    const first = await iter.next()
    if (first.done) {
      throw new Error('CERT_FETCH_EMPTY: server closed stream without sending a cert')
    }

    const bytes = first.value.subarray()
    const json = new TextDecoder('utf8').decode(bytes)
    try {
      return JSON.parse(json)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new Error(`CERT_PARSE_FAILED: ${msg}`)
    }
  })
}

function validateCertShape(cert: unknown): asserts cert is InstallCertificateOnWire {
  if (typeof cert !== 'object' || cert === null) {
    throw new TypeError('CERT_SHAPE_INVALID: not an object')
  }

  const c = cert as Record<string, unknown>
  if (c.version !== 1) throw new TypeError('CERT_SHAPE_INVALID: version must be 1')
  if (c.cert_kind !== 'install') throw new TypeError('CERT_SHAPE_INVALID: cert_kind must be "install"')
  if (typeof c.subject_id !== 'string') throw new TypeError('CERT_SHAPE_INVALID: subject_id missing')
  if (typeof c.issued_at !== 'string') throw new TypeError('CERT_SHAPE_INVALID: issued_at missing')
  if (typeof c.expires_at !== 'string') throw new TypeError('CERT_SHAPE_INVALID: expires_at missing')
  if (typeof c.signature !== 'string') throw new TypeError('CERT_SHAPE_INVALID: signature missing')
  if (c.display_handle !== undefined && typeof c.display_handle !== 'string') {
    throw new TypeError('CERT_SHAPE_INVALID: display_handle must be a string when present')
  }

  if (typeof c.public_key !== 'object' || c.public_key === null) {
    throw new TypeError('CERT_SHAPE_INVALID: public_key missing')
  }

  const pk = c.public_key as Record<string, unknown>
  if (pk.alg !== 'ed25519') throw new TypeError('CERT_SHAPE_INVALID: public_key.alg must be "ed25519"')
  if (typeof pk.key !== 'string') throw new TypeError('CERT_SHAPE_INVALID: public_key.key missing')

  // Strict allowlist — unknown fields are rejected so the caller can't
  // smuggle protocol-malleable data through fingerprint or signature
  // payload (kimi round-1 MEDIUM — strict shape).
  for (const k of Object.keys(c)) {
    if (!KNOWN_CERT_FIELDS.has(k)) {
      throw new TypeError(`CERT_SHAPE_INVALID: unknown cert field "${k}"`)
    }
  }

  for (const k of Object.keys(pk)) {
    if (!KNOWN_PUBKEY_FIELDS.has(k)) {
      throw new TypeError(`CERT_SHAPE_INVALID: unknown public_key field "${k}"`)
    }
  }
}

async function validateCertGuards(
  cert: InstallCertificateOnWire,
  expectedPeerId: string,
  now: Date,
  clockSkewMs: number,
): Promise<void> {
  // Guard 4: subject_id matches what the user said they're pinning.
  if (cert.subject_id !== expectedPeerId) {
    throw new Error(
      `PEER_ID_MISMATCH: cert subject_id ${cert.subject_id} does not match expected peer_id ${expectedPeerId}`,
    )
  }

  // Guards 5+6: time checks. Run BEFORE expensive libp2p derivation
  // (kimi round-1 LOW — guard ordering).
  const issuedAt = Date.parse(cert.issued_at)
  if (!Number.isFinite(issuedAt)) {
    throw new TypeError(`CERT_ISSUED_AT_INVALID: ${cert.issued_at}`)
  }

  if (issuedAt > now.getTime() + clockSkewMs) {
    throw new Error(`CERT_NOT_YET_VALID: issued_at ${cert.issued_at} is in the future beyond clock skew`)
  }

  const expiresAt = Date.parse(cert.expires_at)
  if (!Number.isFinite(expiresAt)) {
    throw new TypeError(`CERT_EXPIRES_AT_INVALID: ${cert.expires_at}`)
  }

  if (expiresAt <= now.getTime()) {
    throw new Error(`CERT_EXPIRED: expires_at ${cert.expires_at} is in the past`)
  }

  // Guard 7: pubkey length === 32 (cheap check before derivation).
  // AMENDMENT_TOFU §A3.2 line 90: public_key.key is standard base64 of
  // raw 32-byte Ed25519 pubkey. Standard base64 vs base64url has no
  // wire interoperability problem here because the InstallIdentityService
  // writer side is also pinned to standard base64. If the spec ever
  // moves to base64url, both ends migrate together.
  const pubBytes = Buffer.from(cert.public_key.key, 'base64')
  if (pubBytes.length !== 32) {
    throw new Error(`CERT_PUBKEY_LENGTH: expected 32 bytes, got ${pubBytes.length}`)
  }

  // Guard 8: subject_id === derivePeerIdFromRawPublicKey(pubkey)
  // (AMENDMENT_TOFU §A3.2 invariant). Wrap the libp2p call in
  // try/catch so an internal stack from `@libp2p/peer-id` doesn't
  // propagate raw (kimi round-1 MEDIUM — unsanitized libp2p throw).
  let derivedPeerId: string
  try {
    derivedPeerId = derivePeerIdFromRawPublicKey(new Uint8Array(pubBytes))
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`PEER_ID_DERIVATION_FAILED: ${msg}`)
  }

  if (derivedPeerId !== cert.subject_id) {
    throw new Error(
      `PEER_ID_DERIVATION_MISMATCH: cert subject_id ${cert.subject_id} does not match derivePeerId(public_key) = ${derivedPeerId}`,
    )
  }

  // Guard 9: self-signature verifies (domain-separated).
  const pubKeyObject = createPublicKey({
    format: 'jwk',
    key: {crv: 'Ed25519', kty: 'OKP', x: Buffer.from(pubBytes).toString('base64url')},
  })
  const {signature, ...payload} = cert
  if (!verifyInstallCert(payload, signature, pubKeyObject)) {
    throw new Error('CERT_SIGNATURE_INVALID: self-signature failed verification')
  }
}

/**
 * Guard 10: handle-collision check. Per AMENDMENT_TOFU §A3.3 step 3,
 * if a *different* peer has already pinned with the same
 * `display_handle`, refuse first contact and surface
 * `HANDLE_COLLISION_REQUIRES_CONFIRMATION` so the operator can confirm
 * out-of-band which peer they intended. We run this OUTSIDE the
 * store's exclusive lock — a small window where two concurrent pins
 * race is acceptable; worst case the operator gets a fresh prompt.
 *
 * Skipped when the cert has no `display_handle` (anonymous peers
 * can't collide on a name that isn't there).
 */
async function assertNoHandleCollision(
  store: TofuStore,
  cert: InstallCertificateOnWire,
): Promise<void> {
  if (cert.display_handle === undefined) return
  const peers = await store.list()
  const collision = peers.find(
    (p) => p.display_handle === cert.display_handle && p.peer_id !== cert.subject_id,
  )
  if (collision) {
    throw new Error(
      `HANDLE_COLLISION_REQUIRES_CONFIRMATION: display_handle ${cert.display_handle} is already ` +
      `pinned to peer ${collision.peer_id}; refusing to auto-pin a different peer (${cert.subject_id}) ` +
      `with the same handle. Resolve out-of-band with \`brv trust verify\`.`,
    )
  }
}

/**
 * Fingerprint = sha256(raw Ed25519 pubkey bytes). AMENDMENT_TOFU §A3.3
 * line 161/184 calls this `install_pubkey_fingerprint`; we store it
 * in the `install_cert_fingerprint` field of `KnownPeer` to keep the
 * tofu-store schema stable across the slice 9.2 → 9.10 transition.
 *
 * Why pubkey-of-cert and NOT canonical(cert):
 *   - peer_id is DERIVED from pubkey, so "same peer_id ⇒ same
 *     fingerprint" must hold by construction (§A3.3 step 2).
 *   - Cert renewal (same key, new expires_at) MUST keep the
 *     fingerprint stable, else the renew flow would trip
 *     TOFU_FINGERPRINT_MISMATCH on legitimate continuity (kimi
 *     round-1 BLOCKING).
 *   - JSON-stringify of the cert is not a canonical form anyway;
 *     two implementations could emit the same logical cert with
 *     different field orders and produce divergent hashes.
 */
function pubkeyFingerprint(cert: InstallCertificateOnWire): string {
  const pubBytes = Buffer.from(cert.public_key.key, 'base64')
  const hash = createHash('sha256').update(pubBytes).digest('hex')
  return `sha256:${hash}`
}
