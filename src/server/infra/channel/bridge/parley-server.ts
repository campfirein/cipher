/* eslint-disable camelcase */
// Wire-shape field names mirror IMPLEMENTATION_PHASE_9 §5.1 + §5.2 on-
// wire JSON and are intentionally snake_case.

import * as lp from 'it-length-prefixed'
import {createHash} from 'node:crypto'

import {type PeerTreeIdentityService} from '../../../../agent/core/trust/peer-tree-identity-service.js'
import {signResponseError, signTranscriptSeal} from '../../../../agent/core/trust/sign.js'
import {type TofuStore} from '../../../../agent/core/trust/tofu-store.js'
import {type ParleyResponseFrame, transcriptDigest} from '../../../core/domain/channel/parley-types.js'
import {type Libp2pHost, type Libp2pStreamLike} from './libp2p-host.js'
import {mockEchoResponse} from './mock-echo-handler.js'
import {NonceLru} from './parley-nonce-lru.js'
import {HandshakeRateLimiter} from './parley-rate-limit.js'
import {type CertKind, type TofuPolicy, verifyHandshakeAndPin} from './parley-verifier.js'

/**
 * Phase 9 / Slice 9.3c-iv — `/brv/parley/query/v1` server.
 *
 * Registers a libp2p handler that:
 *   1. Reads one length-prefixed JSON envelope frame from the dialer.
 *   2. Runs the 11-step verifier (§5.1). On reject:
 *      - Records the failure to the rate-limit counter.
 *      - Emits one signed `error` frame + `transcript_seal` per §5.2.
 *   3. On accept, dispatches to the MockEchoHandler and streams
 *      `agent_message_chunk` + signed `stream_end` + `transcript_seal`.
 *
 * The 12-step verifier disclosure resolver is deferred to a later
 * slice; mock-echo doesn't need it.
 *
 * Stream lifecycle: server writes its frames and RETURNS without
 * closing (same libp2p quirk that bit Slice 9.2 — see
 * identity-server.ts file-level comment). The dialer reads its frames
 * then closes.
 */

export const PARLEY_QUERY_PROTOCOL = '/brv/parley/query/v1'

export interface RegisterParleyServerArgs {
  readonly acceptModes: ReadonlyArray<CertKind>
  readonly clockSkewMs?: number
  readonly host: Libp2pHost
  readonly l2Identity: PeerTreeIdentityService
  readonly nonceLru?: NonceLru
  readonly now?: () => Date
  readonly rateLimiter?: HandshakeRateLimiter
  readonly tofuPolicy: TofuPolicy
  readonly tofuStore: TofuStore
}

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000

export async function registerParleyServer(args: RegisterParleyServerArgs): Promise<void> {
  const nonceLru = args.nonceLru ?? new NonceLru()
  const rateLimiter = args.rateLimiter ?? new HandshakeRateLimiter()
  const now = args.now ?? (() => new Date())
  const clockSkewMs = args.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS

  await args.host.handle(PARLEY_QUERY_PROTOCOL, async (stream) => {
    const transportPeerId = stream.remotePeerId

    // Pre-flight: if the dialer is already rate-limited, do not even
    // read their envelope. The libp2p connection will be hung up by
    // the bad-sig counter elsewhere; this just short-circuits the
    // handler.
    if (rateLimiter.isBlocked(transportPeerId)) return

    const envelope = await readOneEnvelope(stream)
    if (envelope === undefined) {
      // Dialer hung up before sending a frame — nothing to do, no
      // policy reject to signal. Rate-limit considers this a failure
      // so a peer can't slow-loris us.
      rateLimiter.recordFailure(transportPeerId)
      return
    }

    let verifyResult: Awaited<ReturnType<typeof verifyHandshakeAndPin>>
    try {
      verifyResult = await verifyHandshakeAndPin({
        acceptModes: args.acceptModes,
        clockSkewMs,
        envelope,
        nonceLru,
        now: now(),
        tofuPolicy: args.tofuPolicy,
        tofuStore: args.tofuStore,
        transportPeerId,
      })
    } catch (error) {
      rateLimiter.recordFailure(transportPeerId)
      const msg = error instanceof Error ? error.message : String(error)
      await writeErrorTerminal({
        code: 'IMPLEMENTATION_THROW',
        context: undefined,
        l2Identity: args.l2Identity,
        message: msg,
        stream,
      })
      return
    }

    if (!verifyResult.ok) {
      rateLimiter.recordFailure(transportPeerId)
      // Bind the error terminal to the REAL request context when the
      // envelope parsed (kimi round-1 BLOCKING). Only ENVELOPE_MALFORMED
      // / IMPLEMENTATION_THROW pre-parse paths fall back to sentinel.
      const context =
        verifyResult.envelope === undefined || verifyResult.requestEnvelopeHash === undefined
          ? undefined
          : {
              channel_id: verifyResult.envelope.channel_id,
              delivery_id: verifyResult.envelope.delivery_id,
              protocol: verifyResult.envelope.protocol,
              request_envelope_hash: verifyResult.requestEnvelopeHash,
              turn_id: verifyResult.envelope.turn_id,
            }
      await writeErrorTerminal({
        code: verifyResult.reason,
        context,
        l2Identity: args.l2Identity,
        message: `verifier rejected: ${verifyResult.reason}`,
        stream,
      })
      return
    }

    const l2 = await args.l2Identity.loadOrGenerate()
    const frames = mockEchoResponse({
      channel_id: verifyResult.envelope.channel_id,
      delivery_id: verifyResult.envelope.delivery_id,
      l2PrivateKey: l2.privateKey,
      prompt: verifyResult.envelope.prompt,
      protocol: verifyResult.envelope.protocol,
      request_envelope_hash: verifyResult.requestEnvelopeHash,
      turn_id: verifyResult.envelope.turn_id,
    })

    // Sends MUST be sequential — the receiver depends on strictly-
    // increasing seq order, and parallel writes on a libp2p stream
    // do not guarantee ordering.
    for (const frame of frames) {
      // eslint-disable-next-line no-await-in-loop
      await sendFrame(stream, frame)
    }
    // Do NOT close — dialer closes after reading. See file-level
    // comment.
  })
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function readOneEnvelope(stream: Libp2pStreamLike): Promise<undefined | unknown> {
  // Same async-iterator dance used in identity-client to pull exactly
  // ONE length-prefixed frame off a duplex stream.
  const iter = lp.decode(stream as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
  const first = await iter.next()
  if (first.done) return undefined
  const bytes = first.value.subarray()
  const json = new TextDecoder('utf8').decode(bytes)
  try {
    return JSON.parse(json)
  } catch {
    return null  // null distinguishes "parse failed" from "stream EOF"
  }
}

async function sendFrame(stream: Libp2pStreamLike, frame: ParleyResponseFrame): Promise<void> {
  const json = JSON.stringify(frame)
  const bytes = new TextEncoder().encode(json)
  const framed = await encodeLengthPrefixed(bytes)
  await stream.send(framed)
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

/**
 * Request context the verifier was able to extract from a parsed
 * envelope. When `undefined`, the envelope did not parse and the
 * server falls back to a sentinel hash for the error-terminal
 * signature (the dialer cannot authenticate these — kimi round-1
 * documented as the irreducible "indistinguishable from transport
 * drop" path).
 */
export interface ErrorTerminalContext {
  readonly channel_id: string
  readonly delivery_id: string
  readonly protocol: 'delegate' | 'query'
  readonly request_envelope_hash: string
  readonly turn_id: string
}

interface WriteErrorTerminalArgs {
  readonly code: string
  readonly context: ErrorTerminalContext | undefined
  readonly l2Identity: PeerTreeIdentityService
  readonly message: string
  readonly stream: Libp2pStreamLike
}

async function writeErrorTerminal(args: WriteErrorTerminalArgs): Promise<void> {
  const {code, context, l2Identity, message, stream} = args
  const l2 = await l2Identity.loadOrGenerate()
  // Bind signatures to the real request context when the envelope was
  // parsed. Only the no-parse path falls back to a sentinel hash + the
  // 'unknown' placeholder ids (kimi round-1 BLOCKING fix).
  const sentinelHash = createHash('sha256').update('NO_REQUEST_HASH', 'utf8').digest('hex')
  const bound = context ?? {
    channel_id: 'unknown',
    delivery_id: 'unknown',
    protocol: 'query' as const,
    request_envelope_hash: sentinelHash,
    turn_id: 'unknown',
  }

  const errorFramePayload = {
    channel_id: bound.channel_id,
    delivery_id: bound.delivery_id,
    protocol: bound.protocol,
    request_envelope_hash: bound.request_envelope_hash,
    seq: 1,
    terminal_payload: {code, kind: 'error' as const, message},
    turn_id: bound.turn_id,
  }
  const errorFrame: ParleyResponseFrame = {
    code,
    kind: 'error',
    message,
    seq: 1,
    signature: signResponseError(errorFramePayload, l2.privateKey),
  }

  const digest = transcriptDigest([errorFrame])
  const sealPayload = {
    channel_id: bound.channel_id,
    delivery_id: bound.delivery_id,
    ended_state: 'errored',
    protocol: bound.protocol,
    request_envelope_hash: bound.request_envelope_hash,
    transcript_digest: digest,
    turn_id: bound.turn_id,
  }
  const seal: ParleyResponseFrame = {
    kind: 'transcript_seal',
    seq: 2,
    signature: signTranscriptSeal(sealPayload, l2.privateKey),
    transcript_digest: digest,
  }

  await sendFrame(stream, errorFrame)
  await sendFrame(stream, seal)
}
