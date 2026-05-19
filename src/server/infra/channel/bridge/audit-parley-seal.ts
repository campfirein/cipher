/* eslint-disable camelcase */
// Bound-context wire fields use snake_case (parley §5.2).

import type {KeyObject} from 'node:crypto'

import {verifyTranscriptSeal} from '../../../../agent/core/trust/sign.js'
import {
  type ParleyResponseFrame,
  transcriptDigest,
} from '../../../core/domain/channel/parley-types.js'

/**
 * Phase 9 / Slice 9.10 — pure transcript-seal auditor.
 *
 * Extracts the seal-verification logic from `parley-client.ts`'s
 * `verifyResponseStream` so it can be re-run AFTER a parley round
 * has completed and its frames + seal have been persisted to disk.
 * The receive-time path in `parley-client.ts` continues to call this
 * helper inline; later audit paths (e.g. an operator-facing
 * `brv channel verify` CLI, a daemon-level integrity sweep) read
 * the persisted ParleyResponseFrame stream + persisted bound
 * context and call this function with the responder's L2 pubkey to
 * confirm the on-disk transcript is still a faithful representation
 * of what the responder produced.
 *
 * The function does NOT check:
 *   - Frame seq monotonicity (transport-layer concern; persisted
 *     data may legitimately lack heartbeats which would break a
 *     strict seq walk).
 *   - Individual terminal frame signatures (those are checked at
 *     receive time and their signed payloads are not currently
 *     persisted in a re-verifiable form — future scope).
 *   - The error-path seal signature when `bound.ended_state === 'errored'`
 *     (the server uses sentinel `request_envelope_hash` + 'unknown'
 *     ids on pre-parse rejects, so a strict signature check would
 *     incorrectly fail).
 *
 * What it DOES check:
 *   - The seal frame is present.
 *   - `transcript_digest` over the pre-seal frames matches the
 *     persisted seal's `transcript_digest`.
 *   - For non-errored ends, the seal signature verifies under the
 *     responder's L2 pubkey over the canonical bound context.
 */

export type AuditParleySealResult =
  | {ok: false; reason: AuditParleySealFailReason}
  | {ok: true}

export type AuditParleySealFailReason =
  | 'MISSING_SEAL'
  | 'TRANSCRIPT_DIGEST_MISMATCH'
  | 'TRANSCRIPT_SEAL_SIG_INVALID'

export interface AuditParleySealArgs {
  readonly bound: {
    readonly channel_id: string
    readonly delivery_id: string
    readonly ended_state: 'cancelled' | 'completed' | 'errored'
    readonly protocol: 'delegate' | 'query'
    readonly request_envelope_hash: string
    readonly turn_id: string
  }
  /** Full frame sequence including the seal at the last position. */
  readonly frames: ReadonlyArray<ParleyResponseFrame>
  readonly remoteL2PubKey: KeyObject
}

export function auditParleySeal(args: AuditParleySealArgs): AuditParleySealResult {
  const sealIdx = args.frames.findIndex((f) => f.kind === 'transcript_seal')
  if (sealIdx === -1) return {ok: false, reason: 'MISSING_SEAL'}
  const seal = args.frames[sealIdx]
  if (seal.kind !== 'transcript_seal') return {ok: false, reason: 'MISSING_SEAL'}

  const preSeal = args.frames.slice(0, sealIdx)
  const expectedDigest = transcriptDigest(preSeal)
  if (expectedDigest !== seal.transcript_digest) {
    return {ok: false, reason: 'TRANSCRIPT_DIGEST_MISMATCH'}
  }

  // Skip signature verification on the errored path — the server
  // emits a sentinel payload there that would fail strict sig-check
  // by design (see parley-client.ts for the rationale).
  if (args.bound.ended_state === 'errored') return {ok: true}

  const sealPayload = {
    channel_id: args.bound.channel_id,
    delivery_id: args.bound.delivery_id,
    ended_state: args.bound.ended_state,
    protocol: args.bound.protocol,
    request_envelope_hash: args.bound.request_envelope_hash,
    transcript_digest: seal.transcript_digest,
    turn_id: args.bound.turn_id,
  }
  if (!verifyTranscriptSeal(sealPayload, seal.signature, args.remoteL2PubKey)) {
    return {ok: false, reason: 'TRANSCRIPT_SEAL_SIG_INVALID'}
  }

  return {ok: true}
}
