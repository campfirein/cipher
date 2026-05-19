/* eslint-disable camelcase */
import {expect} from 'chai'
import {createHash} from 'node:crypto'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {canonicalize} from '../../../../../../src/agent/core/trust/canonical.js'
import {InstallIdentityService} from '../../../../../../src/agent/core/trust/install-identity-service.js'
import {PeerTreeIdentityService} from '../../../../../../src/agent/core/trust/peer-tree-identity-service.js'
import {signParleyHandshake, signRequestAuth} from '../../../../../../src/agent/core/trust/sign.js'
import {TofuStore} from '../../../../../../src/agent/core/trust/tofu-store.js'
import {ParleyResponseFrameSchema} from '../../../../../../src/server/core/domain/channel/parley-types.js'
import {DEFAULT_BRIDGE_CONFIG} from '../../../../../../src/server/infra/channel/bridge/bridge-config.js'
import {Libp2pHost} from '../../../../../../src/server/infra/channel/bridge/libp2p-host.js'
import {
  PARLEY_QUERY_PROTOCOL,
  registerParleyServer,
} from '../../../../../../src/server/infra/channel/bridge/parley-server.js'

async function encodeLengthPrefixed(
  bytes: Uint8Array,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lp: any,
): Promise<Uint8Array> {
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

// Phase 9 / Slice 9.3c-iv — `/brv/parley/query/v1` server.
//
// Sanity tests for the server module + integration with a real libp2p
// host. The full two-host happy-path lives in 9.3e (after parley-client
// ships in 9.3d).

describe('parley-server (Slice 9.3c-iv)', () => {
  describe('protocol constant', () => {
    it('exposes the canonical `/brv/parley/query/v1` protocol ID', () => {
      expect(PARLEY_QUERY_PROTOCOL).to.equal('/brv/parley/query/v1')
    })
  })

  describe('registerParleyServer + happy-path round-trip', () => {
    let installDirA: string
    let installDirB: string
    let tofuDirB: string

    beforeEach(async () => {
      installDirA = await mkdtemp(join(tmpdir(), 'brv-parley-srv-A-'))
      installDirB = await mkdtemp(join(tmpdir(), 'brv-parley-srv-B-'))
      tofuDirB = await mkdtemp(join(tmpdir(), 'brv-parley-srv-tofu-'))
    })

    afterEach(async () => {
      await rm(installDirA, {force: true, recursive: true})
      await rm(installDirB, {force: true, recursive: true})
      await rm(tofuDirB, {force: true, recursive: true})
    })

    it('verifies an inbound query envelope, dispatches to mock-echo, and emits 3 signed frames', async () => {
      // Bob — receiver.
      const idB = new InstallIdentityService({installDir: installDirB})
      await idB.loadOrGenerate()
      const l2B = new PeerTreeIdentityService({install: idB})
      const bIdentity = await l2B.loadOrGenerate()
      const hostB = new Libp2pHost({config: DEFAULT_BRIDGE_CONFIG, identity: idB})
      await hostB.start()
      const tofuB = new TofuStore({storePath: join(tofuDirB, 'known-peers.jsonl')})
      await registerParleyServer({
        acceptModes: ['peer-tree'],
        host: hostB,
        l2Identity: l2B,
        tofuPolicy: 'auto',
        tofuStore: tofuB,
      })

      // Alice — caller.
      const idA = new InstallIdentityService({installDir: installDirA})
      const aIdentity = await idA.loadOrGenerate()
      const l2A = new PeerTreeIdentityService({install: idA})
      const aL2 = await l2A.loadOrGenerate()
      const hostA = new Libp2pHost({config: DEFAULT_BRIDGE_CONFIG, identity: idA})
      await hostA.start()

      try {
        // Build a valid envelope on Alice's side.
        const prompt = [{text: 'echo this please', type: 'text' as const}]
        const turn_id = 't-server-001'
        const delivery_id = 'd-server-001'
        const channel_id = 'review-2026'
        const protocol = 'query'
        const body_hash = createHash('sha256')
          .update(canonicalize({channel_id, delivery_id, prompt, protocol, turn_id}), 'utf8')
          .digest('hex')
        const reqAuthPayload = {body_hash, requester_cert: aL2.cert}
        const reqAuthSig = signRequestAuth(reqAuthPayload, aL2.privateKey)
        const handshakeInner = {
          install_cert: aIdentity.cert,
          nonce: Buffer.alloc(16, 0x12).toString('base64'),
          tree_cert: aL2.cert,
          ts: new Date().toISOString(),
          version: 1 as const,
        }
        const handshakeSig = signParleyHandshake(handshakeInner, await idA.getL1PrivateKey())
        const envelope = {
          channel_id,
          delivery_id,
          disclosure_intent: protocol,
          handshake: {...handshakeInner, signature: handshakeSig},
          prompt,
          protocol,
          request_auth: {...reqAuthPayload, signature: reqAuthSig},
          turn_id,
          version: 1 as const,
        }

        // Dial Bob, send the envelope as ONE length-prefixed JSON frame,
        // collect response frames.
        const addrB = hostB.getMultiaddrs()[0]
        const lp = await import('it-length-prefixed')
        const envelopeBytes = new TextEncoder().encode(JSON.stringify(envelope))
        const framedEnvelope = await encodeLengthPrefixed(envelopeBytes, lp)

        const parsedFrames = await hostA.dialAndSendAndConsume(
          addrB,
          PARLEY_QUERY_PROTOCOL,
          framedEnvelope,
          async (source) => {
            const out: unknown[] = []
            for await (const msg of lp.decode(source as AsyncIterable<Uint8Array>)) {
              const bytes = msg.subarray() as Uint8Array
              const json = new TextDecoder('utf8').decode(bytes)
              out.push(JSON.parse(json))
              if (out.length >= 3) break
            }

            return out
          },
        )

        expect(parsedFrames).to.have.lengthOf(3)
        expect((parsedFrames[0] as {kind: string}).kind).to.equal('agent_message_chunk')
        expect((parsedFrames[0] as {content: string}).content).to.equal('echo this please')
        expect((parsedFrames[1] as {kind: string}).kind).to.equal('stream_end')
        expect((parsedFrames[2] as {kind: string}).kind).to.equal('transcript_seal')
        for (const f of parsedFrames) {
          expect(ParleyResponseFrameSchema.safeParse(f).success).to.equal(true)
        }

        // Bob's TOFU store now has Alice pinned auto-tofu.
        const pinned = await tofuB.get(aIdentity.peerId)
        expect(pinned?.pin_state).to.equal('auto-tofu')

        // Bob's identity is locally defined — silence lint about unused.
        expect(bIdentity.cert.cert_kind).to.equal('peer-tree')
      } finally {
        await Promise.allSettled([hostA.stop(), hostB.stop()])
      }
    })
  })
})
