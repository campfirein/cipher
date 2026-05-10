/* eslint-disable camelcase */
import {expect} from 'chai'
import {spy, stub} from 'sinon'

import type {Identity} from '../../../../../src/server/core/domain/analytics/identity.js'
import type {StoredAnalyticsRecord} from '../../../../../src/server/core/domain/analytics/stored-record.js'
import type {IIdentityResolver} from '../../../../../src/server/core/interfaces/analytics/i-identity-resolver.js'
import type {IJsonlAnalyticsStore} from '../../../../../src/server/core/interfaces/analytics/i-jsonl-analytics-store.js'
import type {ISuperPropertiesResolver, SuperProperties} from '../../../../../src/server/core/interfaces/analytics/i-super-properties-resolver.js'

import {AnalyticsBatch} from '../../../../../src/server/core/domain/analytics/batch.js'
import {AnalyticsClient} from '../../../../../src/server/infra/analytics/analytics-client.js'
import {BoundedQueue} from '../../../../../src/server/infra/analytics/bounded-queue.js'

type FakeJsonlStore = IJsonlAnalyticsStore & {
  appendSpy: ReturnType<typeof spy>
  readonly records: StoredAnalyticsRecord[]
}

function makeFakeJsonlStore(opts: {appendError?: Error} = {}): FakeJsonlStore {
  const records: StoredAnalyticsRecord[] = []
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
    async updateStatus() {},
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

  describe('queue cap honored (ticket scenario 4)', () => {
    it('should drop excess events per the bounded queue contract', async () => {
      const queue = new BoundedQueue(5)
      const client = new AnalyticsClient({
        identityResolver: makeStubIdentityResolver(makeAnonIdentity()),
        isEnabled: () => true,
        jsonlStore: makeFakeJsonlStore(),
        queue,
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      for (let i = 0; i < 10; i++) {
        client.track(`event_${i}`)
      }

      await flushMicrotasks()

      const batch = await client.flush()
      expect(batch.events).to.have.lengthOf(5)
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
        superPropsResolver: makeStubSuperPropsResolver(makeSuperProps()),
      })

      client.track('e1')
      await flushMicrotasks()

      expect(jsonlStore.appendSpy.called).to.equal(false)
      expect(jsonlStore.records).to.have.lengthOf(0)
      expect(queue.size()).to.equal(0)
    })
  })
})
