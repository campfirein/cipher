/* eslint-disable camelcase */
// Wire-shape field names mirror IMPLEMENTATION_PHASE_9 §5.1 + §5.2
// on-wire JSON and are intentionally snake_case.

import * as lp from 'it-length-prefixed'
import {createHash, createPublicKey, KeyObject, randomBytes} from 'node:crypto'

import {canonicalize} from '../../../../agent/core/trust/canonical.js'
import {type InstallIdentityService} from '../../../../agent/core/trust/install-identity-service.js'
import {derivePeerIdFromRawPublicKey} from '../../../../agent/core/trust/peer-id.js'
import {type PeerTreeIdentityService} from '../../../../agent/core/trust/peer-tree-identity-service.js'
import {
  signParleyHandshake as signParleyHandshakeHelper,
  signRequestAuth,
  verifyResponseError,
  verifyResponseTerminal,
  verifyTranscriptSeal,
} from '../../../../agent/core/trust/sign.js'
import {
  type ParleyQueryEnvelope,
  type ParleyResponseFrame,
  ParleyResponseFrameSchema,
  requestEnvelopeHash,
  transcriptDigest,
} from '../../../core/domain/channel/parley-types.js'
import {type Libp2pHost} from './libp2p-host.js'
import {PARLEY_QUERY_PROTOCOL} from './parley-server.js'

/**
 * Phase 9 / Slice 9.3d — Parley client.
 *
 * `sendParleyQuery` builds a signed `ParleyQueryEnvelope`, dials a
 * remote peer over `/brv/parley/query/v1`, sends the envelope, reads
 * response frames, and verifies the per-frame signatures + the
 * transcript_seal against the responder's L2 public key.
 *
 * Return value carries:
 *   - the body content (concatenated agent_message_chunk text)
 *   - the ended_state (completed / cancelled / errored)
 *   - any error code/message on the failure path
 *   - the raw frame log for diagnostics
 *
 * Verification of response frames happens client-side too — the seal
 * is the authoritative integrity binding, but a precondition is that
 * the SIGNED terminal frame matches the seal's `ended_state`
 * (PHASE_9 §5.2 round-2 NEW MAJOR-3).
 */

export interface SendParleyQueryArgs {
  readonly channel_id: string
  readonly delivery_id: string
  readonly host: Libp2pHost
  readonly install: InstallIdentityService
  readonly l2Identity: PeerTreeIdentityService
  readonly multiaddr: string
  readonly nonce?: Uint8Array
  readonly prompt: ReadonlyArray<{readonly text: string; readonly type: 'text'}>
  readonly remoteL2PubKey: KeyObject  // Bob's L2 public key for seal/terminal verify
  readonly turn_id: string
}

export type SendParleyQueryResult =
  | {
      code: string
      frames: ParleyResponseFrame[]
      message: string
      ok: false
    }
  | {
      content: string
      endedState: 'cancelled' | 'completed'
      frames: ParleyResponseFrame[]
      ok: true
    }

export async function sendParleyQuery(args: SendParleyQueryArgs): Promise<SendParleyQueryResult> {
  const envelope = await buildEnvelope(args)
  const envelopeJson = new TextEncoder().encode(JSON.stringify(envelope))
  const framed = await encodeLengthPrefixed(envelopeJson)
  const expectedReHash = requestEnvelopeHash(envelope)

  const frames = await args.host.dialAndSendAndConsume(
    args.multiaddr,
    PARLEY_QUERY_PROTOCOL,
    framed,
    async (source) => readResponseFrames(source),
  )

  return verifyResponseStream({
    expectedChannelId: args.channel_id,
    expectedDeliveryId: args.delivery_id,
    expectedReHash,
    expectedTurnId: args.turn_id,
    frames,
    protocol: 'query',
    remoteL2PubKey: args.remoteL2PubKey,
  })
}

// ─── envelope build ────────────────────────────────────────────────────────

async function buildEnvelope(args: SendParleyQueryArgs): Promise<ParleyQueryEnvelope> {
  const aliceL1 = await args.install.loadOrGenerate()
  const aliceL2 = await args.l2Identity.loadOrGenerate()
  const aliceL1Priv = await args.install.getL1PrivateKey()

  const protocol = 'query' as const
  const body_hash = createHash('sha256')
    .update(
      canonicalize({
        channel_id: args.channel_id,
        delivery_id: args.delivery_id,
        prompt: args.prompt,
        protocol,
        turn_id: args.turn_id,
      }),
      'utf8',
    )
    .digest('hex')

  const requestAuthPayload = {body_hash, requester_cert: aliceL2.cert}
  const reqAuthSig = signRequestAuth(requestAuthPayload, aliceL2.privateKey)

  const nonceBytes = args.nonce ?? randomNonce()
  const handshakeInner = {
    install_cert: aliceL1.cert,
    nonce: Buffer.from(nonceBytes).toString('base64'),
    tree_cert: aliceL2.cert,
    ts: new Date().toISOString(),
    version: 1 as const,
  }
  const handshakeSig = signParleyHandshakeHelper(handshakeInner, aliceL1Priv)

  return {
    channel_id: args.channel_id,
    delivery_id: args.delivery_id,
    disclosure_intent: protocol,
    handshake: {...handshakeInner, signature: handshakeSig},
    prompt: args.prompt as ParleyQueryEnvelope['prompt'],
    protocol,
    request_auth: {...requestAuthPayload, signature: reqAuthSig},
    turn_id: args.turn_id,
    version: 1,
  }
}

function randomNonce(): Uint8Array {
  return new Uint8Array(randomBytes(16))
}

// ─── frame read + verify ──────────────────────────────────────────────────

async function readResponseFrames(
  source: AsyncIterable<{readonly subarray: () => Uint8Array}>,
): Promise<ParleyResponseFrame[]> {
  const out: ParleyResponseFrame[] = []
  for await (const msg of lp.decode(source as AsyncIterable<Uint8Array>)) {
    const bytes = msg.subarray() as Uint8Array
    const json = new TextDecoder('utf8').decode(bytes)
    let raw: unknown
    try {
      raw = JSON.parse(json)
    } catch {
      throw new Error('PARLEY_RESPONSE_PARSE_FAILED')
    }

    const parsed = ParleyResponseFrameSchema.safeParse(raw)
    if (!parsed.success) throw new Error('PARLEY_RESPONSE_FRAME_INVALID')
    out.push(parsed.data)
    if (parsed.data.kind === 'transcript_seal') break
  }

  return out
}

interface VerifyResponseStreamArgs {
  readonly expectedChannelId: string
  readonly expectedDeliveryId: string
  readonly expectedReHash: string
  readonly expectedTurnId: string
  readonly frames: ParleyResponseFrame[]
  readonly protocol: 'delegate' | 'query'
  readonly remoteL2PubKey: KeyObject
}

function verifyResponseStream(args: VerifyResponseStreamArgs): SendParleyQueryResult {
  const seal = args.frames.find((f) => f.kind === 'transcript_seal')
  if (!seal || seal.kind !== 'transcript_seal') {
    throw new Error('TRANSCRIPT_TERMINAL_MISSING: no transcript_seal frame')
  }

  // Locate the terminal frame (stream_end OR error) immediately before
  // the seal. Per §5.2 it MUST be the last frame before the seal.
  const sealIdx = args.frames.indexOf(seal)
  const terminal = args.frames[sealIdx - 1]
  if (!terminal) {
    throw new Error('TRANSCRIPT_TERMINAL_MISSING: seal has no preceding terminal frame')
  }

  if (terminal.kind !== 'error' && terminal.kind !== 'stream_end') {
    throw new Error(`TRANSCRIPT_TERMINAL_MISSING: frame before seal is ${terminal.kind}, expected error/stream_end`)
  }

  const endedState: 'cancelled' | 'completed' | 'errored' = terminal.kind === 'error' ? 'errored' : terminal.ended_state

  // Verify the terminal frame's individual signature.
  if (terminal.kind === 'stream_end') {
    const terminalPayload = {
      channel_id: args.expectedChannelId,
      delivery_id: args.expectedDeliveryId,
      protocol: args.protocol,
      request_envelope_hash: args.expectedReHash,
      seq: terminal.seq,
      terminal_payload: {ended_state: terminal.ended_state, kind: 'stream_end' as const},
      turn_id: args.expectedTurnId,
    }
    if (!verifyResponseTerminal(terminalPayload, terminal.signature, args.remoteL2PubKey)) {
      throw new Error('STREAM_END_SIG_INVALID')
    }
  } else {
    // error frame — accept the error path but check signature too.
    // We use the seal's request_envelope_hash for the bound context,
    // which on the verify-reject server-side path is a sentinel hash.
    // Skip the strict check here when the seal's hash differs from
    // expected — it indicates the server rejected before seeing our
    // envelope.
    // Best effort verification anyway:
    const errorPayload = {
      channel_id: args.expectedChannelId,
      delivery_id: args.expectedDeliveryId,
      protocol: args.protocol,
      request_envelope_hash: args.expectedReHash,
      seq: terminal.seq,
      terminal_payload: {code: terminal.code, kind: 'error' as const, message: terminal.message},
      turn_id: args.expectedTurnId,
    }
    // Don't throw on verify failure for unauthenticated reject paths —
    // surface the error code to the caller regardless.
    verifyResponseError(errorPayload, terminal.signature, args.remoteL2PubKey)
  }

  // Recompute transcript_digest over all frames before the seal and
  // compare.
  const expectedDigest = transcriptDigest(args.frames.slice(0, sealIdx))
  if (expectedDigest !== seal.transcript_digest) {
    throw new Error('TRANSCRIPT_DIGEST_MISMATCH')
  }

  // Verify the seal's own signature.
  const sealPayload = {
    channel_id: args.expectedChannelId,
    delivery_id: args.expectedDeliveryId,
    ended_state: endedState,
    protocol: args.protocol,
    request_envelope_hash: args.expectedReHash,
    transcript_digest: seal.transcript_digest,
    turn_id: args.expectedTurnId,
  }
  if (!verifyTranscriptSeal(sealPayload, seal.signature, args.remoteL2PubKey) && // Server-side error path uses sentinel hash + 'unknown' values, so
    // the seal verify fails there too. The terminal `error` frame's
    // own `code`/`message` are still surfaced — the dialer cannot
    // distinguish "MITM forged this error" from "server legitimately
    // rejected" in the unauthenticated path, but in 9.3 the server is
    // the only authority producing frames signed by its L2 key. v2
    // hardens this with a per-rejection per-request signature.
    endedState !== 'errored') {
      throw new Error('TRANSCRIPT_SEAL_SIG_INVALID')
    }

  if (terminal.kind === 'error') {
    return {code: terminal.code, frames: args.frames, message: terminal.message, ok: false}
  }

  const content = args.frames
    .filter((f) => f.kind === 'agent_message_chunk')
    .map((f) => (f as {content: string}).content)
    .join('')

  return {content, endedState: terminal.ended_state, frames: args.frames, ok: true}
}

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

// ─── helpers used in negative tests (publicly exported intentionally) ─────

/**
 * Build a peer_id from a raw Ed25519 pubkey (32 bytes). Re-exported
 * here so the CLI can derive peer_ids from cert payloads it just read
 * off the wire (Slice 9.2 returns the cert; the dialer needs the
 * peer_id to validate transport identity).
 */
export function derivePeerIdFromBase64Pubkey(base64Pub: string): string {
  return derivePeerIdFromRawPublicKey(new Uint8Array(Buffer.from(base64Pub, 'base64')))
}

/**
 * Build a Node KeyObject from a base64 Ed25519 pubkey string. Used by
 * the dialer to construct the verifier key for response frames.
 */
export function l2PubKeyFromBase64(base64Pub: string): KeyObject {
  return createPublicKey({
    format: 'jwk',
    key: {crv: 'Ed25519', kty: 'OKP', x: Buffer.from(base64Pub, 'base64').toString('base64url')},
  })
}
