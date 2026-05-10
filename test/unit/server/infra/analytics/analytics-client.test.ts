/* eslint-disable camelcase */
import {expect} from 'chai'
import {spy, stub} from 'sinon'

import type {Identity} from '../../../../../src/server/core/domain/analytics/identity.js'
import type {StoredAnalyticsRecord} from '../../../../../src/server/core/domain/analytics/stored-record.js'
import type {IAnalyticsSender, SendResult} from '../../../../../src/server/core/interfaces/analytics/i-analytics-sender.js'
import type {IIdentityResolver} from '../../../../../src/server/core/interfaces/analytics/i-identity-resolver.js'
import type {IJsonlAnalyticsStore, JsonlAnalyticsStoreUpdateStatus} from '../../../../../src/server/core/interfaces/analytics/i-jsonl-analytics-store.js'
import type {ISuperPropertiesResolver, SuperProperties} from '../../../../../src/server/core/interfaces/analytics/i-super-properties-resolver.js'

import {AnalyticsBatch} from '../../../../../src/server/core/domain/analytics/batch.js'
import {AnalyticsClient} from '../../../../../src/server/infra/analytics/analytics-client.js'
import {BoundedQueue} from '../../../../../src/server/infra/analytics/bounded-queue.js'
import {NoOpAnalyticsSender} from '../../../../../src/server/infra/analytics/no-op-analytics-sender.js'

type FakeJsonlStore = IJsonlAnalyticsStore & {
  appendSpy: ReturnType<typeof spy>
  readonly records: StoredAnalyticsRecord[]
  readonly updateStatusCalls: Array<{ids: readonly string[]; status: JsonlAnalyticsStoreUpdateStatus}>
}

function makeFakeJsonlStore(opts: {appendError?: Error} = {}): FakeJsonlStore {
  const records: StoredAnalyticsRecord[] = []
  const updateStatusCalls: Array<{ids: readonly string[]; status: JsonlAnalyticsStoreUpdateStatus}> = []
  const appendImpl = async (record: StoredAnalyticsRecord): Promise<void> => {
    if (opts.appendError) throw opts.appendError
    records.push(record)
  }

  const appendSpy = spy(appendImpl)
  return {
    append: appendSpy,
    appendSpy,
    droppedFullCount: () => 0,
    droppedSentCount: () => 0,
    list: async () => ({rows: [...records], total: records.length}),
    loadPending: async () => records.filter((r) => r.status === 'pending'),
    records,
    // Simplified mirror of M9.2's updateStatus for unit tests: 'sent' is a terminal flip;
    // 'failed' flips status directly. The real retry-cap (increment attempts, stay
    // 'pending' until cap) lives in M9.2 and is verified end-to-end in M10.3.
    async updateStatus(ids: readonly string[], status: JsonlAnalyticsStoreUpdateStatus): Promise<void> {
      updateStatusCalls.push({ids: [...ids], status})
      if (ids.length === 0) return
      const idSet = new Set(ids)
      for (let i = 0; i < records.length; i++) {
        if (idSet.has(records[i].id)) records[i] = {...records[i], status}
      }
    },
    updateStatusCalls,
  }
}

type FakeSender = IAnalyticsSender & {
  readonly calls: Array<readonly StoredAnalyticsRecord[]>
}

type FakeSenderOpts =
  | {error: Error; kind: 'throw';}
  | {failedIds: readonly string[]; kind: 'mixed'; succeededIds: readonly string[]}
  | {kind: 'all-failed'}
  | {kind: 'all-succeeded'}

function makeFakeSender(opts?: FakeSenderOpts): FakeSender {
  const resolved: FakeSenderOpts = opts ?? {kind: 'all-succeeded'}
  const calls: Array<readonly StoredAnalyticsRecord[]> = []
  return {
    calls,
    async send(records: readonly StoredAnalyticsRecord[]): Promise<SendResult> {
      calls.push([...records])
      switch (resolved.kind) {
        case 'all-failed': {
          return {failed: records.map((r) => r.id), succeeded: []}
        }

        case 'all-succeeded': {
          return {failed: [], succeeded: records.map((r) => r.id)}
        }

        case 'mixed': {
          return {failed: [...resolved.failedIds], succeeded: [...resolved.succeededIds]}
        }

        case 'throw': {
          throw resolved.error
        }
      }
    },
  }
}

const validDeviceId = '550e8400-e29b-41d4-a716-446655440000'

function makeAnonIdentity(): Identity {
  return {device_id: validDeviceId}
}

function makeRegisteredIdentity(): Identity {
  return {
    device_id: validDeviceId,
    email: 'alice@example.com',
    name: 'Alice',
    user_id: 'user-123',
  }
}

function makeSuperProps(): SuperProperties {
  return {
    cli_version: '3.10.3',
    device_id: validDeviceId,
    environment: 'production',
    node_version: 'v24.13.1',
    os: 'darwin',
  }
}

function makeStubIdentityResolver(identity: Identity): IIdentityResolver {
  return {resolve: stub().resolves(identity)}
}

function makeStubSuperPropsResolver(props: SuperProperties): ISuperPropertiesResolver {
  return {resolve: stub().resolves(props)}
}

async function flushMicrotasks(): Promise<void> {
  // Drain the microtask queue so fire-and-forget async work completes
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

async function seedPending(client: AnalyticsClient, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    client.track(`event_${i}`)
  }

  await flushMicrotasks()
}

describe('AnalyticsClient', () => {
  describe('disabled state (ticket scenario 1)', () => {
    it('should be a true no-op when isEnabled returns false', async () => {
      const queue = new BoundedQueue()
      const identityResolver = makeStubIdentityResolver(makeAnonIdentity())
      const superPropsResolver = makeStubSuperPropsResolver(makeSuperProps())

      const client = new AnalyticsClient({
        identityResolver,
        isEnabled: () => false,
        jsonlStore: makeFakeJsonlStore(),
        queue,
        sender: makeFakeSender(),
        superPropsResolver,
      })

      for (let i = 0; i < 1000; i++) {
        client.track(`event_${i}`, {x: i})
      }

      await flushMicrotasks()

      expect(queue.size()).to.equal(0)
      expect((identityResolver.resolve as ReturnType<typeof stub>).called, 'identityResolver.resolve must NOT be called').to.be.false
      expect((superPropsResolver.resolve as ReturnType<typeof stub>).called, 'superPropsResolver.resolve must NOT be called').to.be.false
    })
  })

  describe('enabled state (ticket scenario 2)', () => {
    it('should resolve identity + super-props and push to queue with timestamp', async () => {
      const queue = new BoundedQueue()
      const identity = makeRegisteredIdentity()
      const superProps = makeSuperProps()

      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(identity),
        isEnabled: () => true,
        jsonlStore: makeFakeJsonlStore(),
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(superProps),
      })

      const before = Date.now()
      client.track('e1', {x: 1})
      await flushMicrotasks()
      const after = Date.now()

      const batch = await client.flush()

      expect(batch.events).to.have.lengthOf(1)
      const [event] = batch.events
      expect(event.name).to.equal('e1')
      expect(event.identity).to.deep.equal(identity)
      expect(event.timestamp).to.be.at.least(before)
      expect(event.timestamp).to.be.at.most(after)

      // user property merged
      expect(event.properties.x).to.equal(1)
      // all 5 super properties stamped
      expect(event.properties.cli_version).to.equal('3.10.3')
      expect(event.properties.device_id).to.equal(validDeviceId)
      expect(event.properties.environment).to.equal('production')
      expect(event.properties.node_version).to.equal('v24.13.1')
      expect(event.properties.os).to.equal('darwin')
    })
  })

  describe('auth transition mid-batch (ticket scenario 3)', () => {
    it('should reflect per-track identity resolution when auth state flips', async () => {
      const queue = new BoundedQueue()
      let currentIdentity: Identity = makeAnonIdentity()
      const identityResolver: IIdentityResolver = {
        resolve: async () => currentIdentity,
      }
      const superPropsResolver = makeStubSuperPropsResolver(makeSuperProps())

      const client = new AnalyticsClient({
        identityResolver,
        isEnabled: () => true,
        jsonlStore: makeFakeJsonlStore(),
        queue,
        sender: makeFakeSender(),
        superPropsResolver,
      })

      client.track('a1')
      client.track('a2')
      await flushMicrotasks()

      currentIdentity = makeRegisteredIdentity()
      client.track('r1')
      client.track('r2')
      await flushMicrotasks()

      const batch = await client.flush()
      expect(batch.events).to.have.lengthOf(4)
      expect(batch.events[0].identity).to.deep.equal(makeAnonIdentity())
      expect(batch.events[1].identity).to.deep.equal(makeAnonIdentity())
      expect(batch.events[2].identity).to.deep.equal(makeRegisteredIdentity())
      expect(batch.events[3].identity).to.deep.equal(makeRegisteredIdentity())
    })
  })

  describe('M10.2 burst-overflow regression: flush reads from JSONL, not the bounded queue', () => {
    it('should ship every tracked event even when the in-memory queue dropped half during a burst', async () => {
      // M10.2's central architectural call: flush() reads from JSONL via loadPending(),
      // NOT from the in-memory queue. Without this, events tracked beyond queue.maxSize
      // would be silently dropped from the active flush path until daemon restart.
      const queue = new BoundedQueue(5)
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      for (let i = 0; i < 10; i++) {
        client.track(`event_${i}`)
      }

      await flushMicrotasks()

      const batch = await client.flush()
      // All 10 events durably stored and flushed — JSONL is the source of truth.
      expect(batch.events).to.have.lengthOf(10)
      expect(jsonlStore.records).to.have.lengthOf(10)
      // The queue still honors its cap (the regression here is independent of queue eviction).
      expect(queue.droppedCount()).to.equal(5)
    })
  })

  describe('flush returns valid AnalyticsBatch (ticket scenario 5)', () => {
    it('should return a batch that round-trips through fromJson', async () => {
      const queue = new BoundedQueue()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore: makeFakeJsonlStore(),
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      client.track('round_trip')
      await flushMicrotasks()

      const batch = await client.flush()
      const restored = AnalyticsBatch.fromJson(batch.toJson())

      expect(restored).to.not.be.undefined
      expect(restored?.events).to.have.lengthOf(1)
      expect(restored?.events[0].name).to.equal('round_trip')
    })

    it('should return an empty batch when the queue has been fully drained', async () => {
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore: makeFakeJsonlStore(),
        queue: new BoundedQueue(),
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      const first = await client.flush()
      expect(first.events).to.deep.equal([])
    })
  })

  describe('error containment (analytics must not crash consumers)', () => {
    it('should silently drop the event when identity resolution rejects', async () => {
      const queue = new BoundedQueue()
      const identityResolver: IIdentityResolver = {
        resolve: () => Promise.reject(new Error('identity boom')),
      }

      const client = new AnalyticsClient({
        identityResolver,
        isEnabled: () => true,
        jsonlStore: makeFakeJsonlStore(),
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      // Must not throw to the caller
      expect(() => client.track('boom')).to.not.throw()

      await flushMicrotasks()

      expect(queue.size()).to.equal(0)
    })

    it('should silently drop the event when super-properties resolution rejects', async () => {
      const queue = new BoundedQueue()
      const superPropsResolver: ISuperPropertiesResolver = {
        resolve: () => Promise.reject(new Error('super-props boom')),
      }

      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore: makeFakeJsonlStore(),
        queue,
        sender: makeFakeSender(),
        superPropsResolver,
      })

      expect(() => client.track('boom')).to.not.throw()

      await flushMicrotasks()

      expect(queue.size()).to.equal(0)
    })
  })

  describe('timestamp captured at call site, not resolver settle time', () => {
    it('should stamp timestamp when track() is called even if resolvers settle later', async () => {
      const queue = new BoundedQueue()
      let resolveIdentity!: (id: Identity) => void
      const slowIdentityResolver: IIdentityResolver = {
        resolve: () =>
          new Promise<Identity>((resolve) => {
            resolveIdentity = resolve
          }),
      }

      const client = new AnalyticsClient({
        identityResolver: slowIdentityResolver,
        isEnabled: () => true,
        jsonlStore: makeFakeJsonlStore(),
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      const before = Date.now()
      client.track('e1')
      const after = Date.now()

      // Hold the resolver pending across a real timer gap so settle-time and
      // call-time diverge meaningfully — without this the bug is too subtle to detect.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50)
      })

      const settleStart = Date.now()
      resolveIdentity(makeAnonIdentity())
      await flushMicrotasks()

      const batch = await client.flush()
      expect(batch.events).to.have.lengthOf(1)
      // Captured-at-call: timestamp falls within the call-site window…
      expect(batch.events[0].timestamp).to.be.at.least(before)
      expect(batch.events[0].timestamp).to.be.at.most(after)
      // …and is BEFORE the resolver settled (proving capture-at-call, not capture-at-settle).
      expect(batch.events[0].timestamp).to.be.lessThan(settleStart)
    })
  })

  describe('super-properties precedence', () => {
    it('should let super-properties win on key conflict with user properties', async () => {
      const queue = new BoundedQueue()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore: makeFakeJsonlStore(),
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      client.track('e1', {cli_version: 'lying', custom: 'kept'})
      await flushMicrotasks()

      const batch = await client.flush()
      expect(batch.events).to.have.lengthOf(1)
      const [event] = batch.events
      // Super-property wins
      expect(event.properties.cli_version).to.equal('3.10.3')
      // User property without conflict is preserved
      expect(event.properties.custom).to.equal('kept')
    })
  })

  describe('M9.3 JSONL-first persistence (dual write)', () => {
    it('should append to JSONL before pushing to queue (happy path)', async () => {
      const queue = new BoundedQueue()
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      client.track('e1', {x: 1})
      await flushMicrotasks()

      // JSONL has the row
      expect(jsonlStore.records).to.have.lengthOf(1)
      const stored = jsonlStore.records[0]
      expect(stored.name).to.equal('e1')
      expect(stored.status).to.equal('pending')
      expect(stored.attempts).to.equal(0)
      expect(stored.id).to.be.a('string').and.have.length.greaterThan(0)
      // Queue mirror has the same record (id propagates)
      expect(queue.size()).to.equal(1)
      const [drained] = queue.drain()
      expect(drained.id).to.equal(stored.id)
    })

    it('should generate distinct uuid id per track call', async () => {
      const queue = new BoundedQueue()
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      for (let i = 0; i < 5; i++) {
        client.track(`event_${i}`)
      }

      await flushMicrotasks()

      const ids = jsonlStore.records.map((r) => r.id)
      expect(new Set(ids).size).to.equal(5) // all distinct
      expect(jsonlStore.records).to.have.lengthOf(5)
    })

    it('should NOT push to queue when JSONL append fails', async () => {
      const queue = new BoundedQueue()
      const jsonlStore = makeFakeJsonlStore({appendError: new Error('disk full')})
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      expect(() => client.track('boom')).to.not.throw()
      await flushMicrotasks()

      // JSONL append rejected (called once, but no record persisted)
      expect(jsonlStore.appendSpy.calledOnce).to.equal(true)
      expect(jsonlStore.records).to.have.lengthOf(0)
      // Queue must NOT receive the event when JSONL persist failed
      expect(queue.size()).to.equal(0)
    })

    it('should NOT push to queue and NOT crash when JSONL fails on every track', async () => {
      const queue = new BoundedQueue()
      const jsonlStore = makeFakeJsonlStore({appendError: new Error('persistent disk error')})
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      for (let i = 0; i < 100; i++) {
        expect(() => client.track(`event_${i}`)).to.not.throw()
      }

      await flushMicrotasks()

      expect(queue.size()).to.equal(0)
    })

    it('should track queue.size() growth equal to JSONL row count under non-burst load', async () => {
      const queue = new BoundedQueue()
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      const N = 20
      for (let i = 0; i < N; i++) {
        client.track(`event_${i}`)
      }

      await flushMicrotasks()

      expect(queue.size()).to.equal(N)
      expect(jsonlStore.records).to.have.lengthOf(N)
    })

    it('should NOT call jsonlStore.append when analytics disabled', async () => {
      const queue = new BoundedQueue()
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => false,
        jsonlStore,
        queue,
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      client.track('e1')
      await flushMicrotasks()

      expect(jsonlStore.appendSpy.called).to.equal(false)
      expect(jsonlStore.records).to.have.lengthOf(0)
      expect(queue.size()).to.equal(0)
    })
  })

  describe('M10.2 mirror flush: invokes sender, mirrors result back to JSONL via updateStatus', () => {
    it('should pass loadPending records to sender.send exactly once per flush', async () => {
      const jsonlStore = makeFakeJsonlStore()
      const sender = makeFakeSender()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue: new BoundedQueue(),
        sender,
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      await seedPending(client, 3)
      await client.flush()

      expect(sender.calls).to.have.lengthOf(1)
      const [shipped] = sender.calls
      expect(shipped).to.have.lengthOf(3)
      expect(shipped.map((r) => r.name).sort()).to.deep.equal(['event_0', 'event_1', 'event_2'])
    })

    it('should mirror all-succeeded result by flipping rows to status=sent', async () => {
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue: new BoundedQueue(),
        sender: makeFakeSender({kind: 'all-succeeded'}),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      await seedPending(client, 3)
      await client.flush()

      expect(jsonlStore.records.map((r) => r.status)).to.deep.equal(['sent', 'sent', 'sent'])
      // updateStatus(succeeded, 'sent') called with all 3 ids; updateStatus(failed, 'failed') called with empty
      const calls = jsonlStore.updateStatusCalls
      expect(calls.find((c) => c.status === 'sent')?.ids).to.have.lengthOf(3)
      expect(calls.find((c) => c.status === 'failed')?.ids).to.have.lengthOf(0)
    })

    it('should mirror all-failed result by flipping rows to status=failed', async () => {
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue: new BoundedQueue(),
        sender: makeFakeSender({kind: 'all-failed'}),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      await seedPending(client, 2)
      await client.flush()

      // Note: real M9.2 keeps rows at 'pending' until MAX_ATTEMPTS — the FAKE store flips to
      // 'failed' immediately for unit-test simplicity. End-to-end retry-cap composition is
      // verified in M10.3 against the real JsonlAnalyticsStore.
      expect(jsonlStore.records.map((r) => r.status)).to.deep.equal(['failed', 'failed'])
      const calls = jsonlStore.updateStatusCalls
      expect(calls.find((c) => c.status === 'failed')?.ids).to.have.lengthOf(2)
      expect(calls.find((c) => c.status === 'sent')?.ids).to.have.lengthOf(0)
    })

    it('should mirror mixed result: some ids to sent, some to failed', async () => {
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue: new BoundedQueue(),
        // Late-bound: build the mixed sender with the actual record ids after seeding.
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      await seedPending(client, 4)
      const ids = jsonlStore.records.map((r) => r.id)
      // Re-construct client with a mixed sender keyed off the seeded ids.
      const jsonlStore2 = makeFakeJsonlStore()
      const client2 = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore: jsonlStore2,
        queue: new BoundedQueue(),
        sender: makeFakeSender({failedIds: [ids[2], ids[3]], kind: 'mixed', succeededIds: [ids[0], ids[1]]}),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      // Re-seed with the SAME ids by appending records directly into jsonlStore2.records.
      for (const r of jsonlStore.records) jsonlStore2.records.push(r)

      await client2.flush()

      // First two sent, last two flipped to failed (per fake-store simplified policy).
      expect(jsonlStore2.records.find((r) => r.id === ids[0])?.status).to.equal('sent')
      expect(jsonlStore2.records.find((r) => r.id === ids[1])?.status).to.equal('sent')
      expect(jsonlStore2.records.find((r) => r.id === ids[2])?.status).to.equal('failed')
      expect(jsonlStore2.records.find((r) => r.id === ids[3])?.status).to.equal('failed')
    })

    it('should treat a sender that throws as all-failed (no daemon crash)', async () => {
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue: new BoundedQueue(),
        sender: makeFakeSender({error: new Error('network boom'), kind: 'throw'}),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      await seedPending(client, 3)

      // The flush itself must not throw — daemon survives.
      let threw = false
      try {
        await client.flush()
      } catch {
        threw = true
      }

      expect(threw, 'flush MUST NOT throw when sender throws').to.equal(false)
      expect(jsonlStore.records.map((r) => r.status)).to.deep.equal(['failed', 'failed', 'failed'])
    })

    it('should leave JSONL untouched when the no-op sender is wired (regression for review issue #4)', async () => {
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue: new BoundedQueue(),
        sender: new NoOpAnalyticsSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      await seedPending(client, 5)
      const beforeStatuses = jsonlStore.records.map((r) => r.status)
      const beforeAttempts = jsonlStore.records.map((r) => r.attempts)

      await client.flush()

      expect(jsonlStore.records.map((r) => r.status)).to.deep.equal(beforeStatuses)
      expect(jsonlStore.records.map((r) => r.attempts)).to.deep.equal(beforeAttempts)
      // Both updateStatus calls received empty arrays (no-op sender returns {[],[]}).
      expect(jsonlStore.updateStatusCalls).to.deep.equal([
        {ids: [], status: 'sent'},
        {ids: [], status: 'failed'},
      ])
    })

    it('should return a wire-shape AnalyticsBatch (id/attempts/status stripped via toWireEvent)', async () => {
      const jsonlStore = makeFakeJsonlStore()
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore,
        queue: new BoundedQueue(),
        sender: makeFakeSender(),
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      await seedPending(client, 1)
      const batch = await client.flush()

      expect(batch.events).to.have.lengthOf(1)
      const [event] = batch.events
      expect(event).to.have.property('name', 'event_0')
      expect(event).to.have.property('timestamp')
      expect(event).to.have.property('properties')
      expect(event).to.have.property('identity')
      // Local-only fields stripped on the wire.
      expect(event).to.not.have.property('id')
      expect(event).to.not.have.property('attempts')
      expect(event).to.not.have.property('status')
    })
  })
})
