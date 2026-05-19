/* eslint-disable camelcase */
// Bound-context wire fields use snake_case (parley §5.2).

import {expect} from 'chai'
import {generateKeyPairSync} from 'node:crypto'

import {signTranscriptSeal} from '../../../../../../src/agent/core/trust/sign.js'
import {
  type ParleyResponseFrame,
  transcriptDigest,
} from '../../../../../../src/server/core/domain/channel/parley-types.js'
import {auditParleySeal} from '../../../../../../src/server/infra/channel/bridge/audit-parley-seal.js'

// Phase 9 / Slice 9.10 — extract-and-harden the transcript-seal
// verification helper so it can be re-run AFTER frames have been
// persisted. Receive-time verification keeps working unchanged; this
// helper is the building block for any future audit path
// (`brv channel verify`, daemon integrity sweep, etc.).

const keypair = generateKeyPairSync('ed25519')
const remoteL2PubKey = keypair.publicKey

const buildBound = (overrides: Partial<{
  channel_id: string
  delivery_id: string
  ended_state: 'cancelled' | 'completed' | 'errored'
  protocol: 'delegate' | 'query'
  request_envelope_hash: string
  turn_id: string
}> = {}) => ({
  channel_id: 'demo-channel',
  delivery_id: 'd-001',
  ended_state: 'completed' as const,
  protocol: 'query' as const,
  request_envelope_hash: 'a'.repeat(64),
  turn_id: 't-001',
  ...overrides,
})

const buildSignedTranscript = (
  preSealFrames: ParleyResponseFrame[],
  bound: ReturnType<typeof buildBound>,
): ParleyResponseFrame[] => {
  const digest = transcriptDigest(preSealFrames)
  const sealPayload = {
    channel_id: bound.channel_id,
    delivery_id: bound.delivery_id,
    ended_state: bound.ended_state,
    protocol: bound.protocol,
    request_envelope_hash: bound.request_envelope_hash,
    transcript_digest: digest,
    turn_id: bound.turn_id,
  }
  const signature = signTranscriptSeal(sealPayload, keypair.privateKey)
  return [
    ...preSealFrames,
    {
      kind: 'transcript_seal',
      seq: preSealFrames.length + 1,
      signature,
      transcript_digest: digest,
    },
  ]
}

describe('auditParleySeal (slice 9.10)', () => {
  it('returns ok=true for a faithfully-persisted transcript', () => {
    const bound = buildBound()
    const preSeal: ParleyResponseFrame[] = [
      {content: 'hello', kind: 'agent_message_chunk', seq: 1},
      {ended_state: 'completed', kind: 'stream_end', seq: 2, signature: 'AA'.repeat(32) + '=='},
    ]
    const frames = buildSignedTranscript(preSeal, bound)
    const result = auditParleySeal({bound, frames, remoteL2PubKey})
    expect(result.ok).to.equal(true)
  })

  it('returns MISSING_SEAL when no seal frame is present', () => {
    const bound = buildBound()
    const frames: ParleyResponseFrame[] = [
      {content: 'hello', kind: 'agent_message_chunk', seq: 1},
    ]
    const result = auditParleySeal({bound, frames, remoteL2PubKey})
    expect(result.ok).to.equal(false)
    if (!result.ok) expect(result.reason).to.equal('MISSING_SEAL')
  })

  it('returns TRANSCRIPT_DIGEST_MISMATCH when a pre-seal frame was tampered', () => {
    const bound = buildBound()
    const preSeal: ParleyResponseFrame[] = [
      {content: 'hello', kind: 'agent_message_chunk', seq: 1},
      {ended_state: 'completed', kind: 'stream_end', seq: 2, signature: 'AA'.repeat(32) + '=='},
    ]
    const frames = buildSignedTranscript(preSeal, bound)

    // Tamper the persisted chunk AFTER the seal was signed.
    const tampered: ParleyResponseFrame[] = [
      {content: 'TAMPERED', kind: 'agent_message_chunk', seq: 1},
      frames[1],
      frames[2],
    ]
    const result = auditParleySeal({bound, frames: tampered, remoteL2PubKey})
    expect(result.ok).to.equal(false)
    if (!result.ok) expect(result.reason).to.equal('TRANSCRIPT_DIGEST_MISMATCH')
  })

  it('returns TRANSCRIPT_SEAL_SIG_INVALID when the seal signature does not verify', () => {
    const bound = buildBound()
    const preSeal: ParleyResponseFrame[] = [
      {content: 'hello', kind: 'agent_message_chunk', seq: 1},
      {ended_state: 'completed', kind: 'stream_end', seq: 2, signature: 'AA'.repeat(32) + '=='},
    ]
    const frames = buildSignedTranscript(preSeal, bound)

    // Verify with the WRONG pubkey — same shape but different key.
    const otherKey = generateKeyPairSync('ed25519').publicKey
    const result = auditParleySeal({bound, frames, remoteL2PubKey: otherKey})
    expect(result.ok).to.equal(false)
    if (!result.ok) expect(result.reason).to.equal('TRANSCRIPT_SEAL_SIG_INVALID')
  })

  it('returns TRANSCRIPT_SEAL_SIG_INVALID when the bound context was tampered (binds to a different turn)', () => {
    const bound = buildBound()
    const preSeal: ParleyResponseFrame[] = [
      {content: 'hello', kind: 'agent_message_chunk', seq: 1},
      {ended_state: 'completed', kind: 'stream_end', seq: 2, signature: 'AA'.repeat(32) + '=='},
    ]
    const frames = buildSignedTranscript(preSeal, bound)

    // Auditor passes a DIFFERENT delivery_id — the digest still matches
    // but the seal's bound context no longer matches, so signature
    // verification must fail.
    const tamperedBound = {...bound, delivery_id: 'd-other'}
    const result = auditParleySeal({bound: tamperedBound, frames, remoteL2PubKey})
    expect(result.ok).to.equal(false)
    if (!result.ok) expect(result.reason).to.equal('TRANSCRIPT_SEAL_SIG_INVALID')
  })

  it('skips signature verification when ended_state is errored (server uses sentinel payload)', () => {
    const bound = buildBound({ended_state: 'errored'})
    const preSeal: ParleyResponseFrame[] = [
      {code: 'BOOM', kind: 'error', message: 'reject', seq: 1, signature: 'AA'.repeat(32) + '=='},
    ]
    // Even though we sign the seal here for ergonomics, the auditor
    // MUST accept any digest-matching errored seal regardless of
    // signature — mirroring the receive-time semantics.
    const frames = buildSignedTranscript(preSeal, bound)

    const otherKey = generateKeyPairSync('ed25519').publicKey
    const result = auditParleySeal({bound, frames, remoteL2PubKey: otherKey})
    expect(result.ok).to.equal(true)
  })

  it('returns TRANSCRIPT_DIGEST_MISMATCH even on errored path (the digest check IS still enforced)', () => {
    const bound = buildBound({ended_state: 'errored'})
    const preSeal: ParleyResponseFrame[] = [
      {code: 'BOOM', kind: 'error', message: 'reject', seq: 1, signature: 'AA'.repeat(32) + '=='},
    ]
    const frames = buildSignedTranscript(preSeal, bound)

    // Tamper the pre-seal error message — digest no longer matches.
    const tampered: ParleyResponseFrame[] = [
      {...preSeal[0], message: 'tampered'} as ParleyResponseFrame,
      frames[1],
    ]
    const result = auditParleySeal({bound, frames: tampered, remoteL2PubKey})
    expect(result.ok).to.equal(false)
    if (!result.ok) expect(result.reason).to.equal('TRANSCRIPT_DIGEST_MISMATCH')
  })

  it('returns MISSING_SEAL when the input frames array is empty', () => {
    const bound = buildBound()
    const result = auditParleySeal({bound, frames: [], remoteL2PubKey})
    expect(result.ok).to.equal(false)
    if (!result.ok) expect(result.reason).to.equal('MISSING_SEAL')
  })
})
