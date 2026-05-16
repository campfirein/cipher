import {expect} from 'chai'

import type {AcpDriverPromptArgs, AcpDriverStatus, IAcpDriver, TurnEventPayload} from '../../../../../src/server/core/interfaces/channel/i-acp-driver.js'
import type {ChannelMeta} from '../../../../../src/shared/types/channel.js'

import {ChannelStore} from '../../../../../src/server/infra/channel/channel-store.js'
import {AcpDriverPool} from '../../../../../src/server/infra/channel/drivers/acp-driver-pool.js'
import {CancelCoordinator} from '../../../../../src/server/infra/channel/drivers/cancel-coordinator.js'
import {MockAcpDriver} from '../../../../../src/server/infra/channel/drivers/mock-driver.js'
import {PermissionBroker} from '../../../../../src/server/infra/channel/drivers/permission-broker.js'
import {ChannelOrchestrator} from '../../../../../src/server/infra/channel/orchestrator.js'
import {ChannelEventsWriter} from '../../../../../src/server/infra/channel/storage/events-writer.js'
import {ChannelSnapshotWriter} from '../../../../../src/server/infra/channel/storage/snapshot-writer.js'
import {ChannelTreeReader} from '../../../../../src/server/infra/channel/storage/tree-reader.js'
import {TurnSequenceAllocator} from '../../../../../src/server/infra/channel/storage/turn-sequence-allocator.js'
import {ChannelWriteSerializer} from '../../../../../src/server/infra/channel/storage/write-serializer.js'
import {makeTempContextTree} from '../../../../helpers/temp-context-tree.js'
import {removeTempDir} from '../../../../helpers/temp-dir.js'

// Slice 8.11 Layer 2 — `warmDriversForProject(projectRoot)` enumerates
// channels in a project, reads each meta.json, and Promise.allSettled-spawns
// drivers for every acp-agent member NOT already in the pool. Called by
// brv-server.ts on the first client connection per (project, daemon-lifetime).
//
// Codex Q6 invariants:
//   1. Per-key in-flight guard — concurrent warm + inviteMember don't double-spawn.
//   2. Post-spawn re-check — if the channel was archived or member removed
//      during the spawn handshake, stop the fresh driver and skip registration.
//   3. Existing driver in pool → skip; do not double-register.
//
// Codex Q4: do not auto-rewarm after `releaseChannel` or `archiveChannel`.
//   The warm only runs when explicitly called (i.e. on first client connection).

class CountingDriver implements IAcpDriver {
  public static instances = 0
  public acpInitialize: undefined
  public readonly capabilities: string[] = []
  public readonly handle: string
  public protocolVersion: number | undefined
  public startCount = 0
  public status: AcpDriverStatus = 'idle'
  public stopCount = 0

  public constructor(handle: string) {
    this.handle = handle
    CountingDriver.instances += 1
  }

  async cancel(): Promise<void> {}

  async probeSession(): Promise<boolean> {
    return true
  }

  prompt(_args: AcpDriverPromptArgs): AsyncIterableIterator<TurnEventPayload> {
     
    async function* empty(): AsyncIterableIterator<TurnEventPayload> {}
    return empty()
  }

  async respondToPermission(_id: string, _r: unknown): Promise<void> {}

  async start(): Promise<void> {
    this.startCount += 1
    this.status = 'idle'
  }

  async stop(): Promise<void> {
    this.stopCount += 1
    this.status = 'stopped'
  }
}

describe('ChannelOrchestrator.warmDriversForProject (Slice 8.11 Layer 2)', () => {
  let projectRoot: string
  let store: ChannelStore
  let orchestrator: ChannelOrchestrator
  let pool: AcpDriverPool
  let broker: PermissionBroker
  let constructedDrivers: CountingDriver[]

  beforeEach(async () => {
    projectRoot = await makeTempContextTree()
    const serializer = new ChannelWriteSerializer()
    store = new ChannelStore({
      eventsWriter: new ChannelEventsWriter({serializer}),
      snapshotWriter: new ChannelSnapshotWriter(),
      treeReader: new ChannelTreeReader(),
      writeSerializer: serializer,
    })
    pool = new AcpDriverPool()
    broker = new PermissionBroker()
    constructedDrivers = []
    CountingDriver.instances = 0

    let idCounter = 0
    const seqAllocator = new TurnSequenceAllocator()
    const cancelCoordinator = new CancelCoordinator({
      broker,
      pool,
      seqAllocator,
      async writeEvent() {},
    })
    const broadcaster = {
      broadcastToChannel() {},
    }

    orchestrator = new ChannelOrchestrator({
      broadcaster,
      cancelCoordinator,
      clock: () => new Date('2026-05-17T12:00:00.000Z'),
      driverFactory(_invocation, handle) {
        const d = new CountingDriver(handle)
        constructedDrivers.push(d)
        return d
      },
      idGenerator: () => `id-${++idCounter}`,
      permissionBroker: broker,
      pool,
      seqAllocator,
      store,
    })
  })

  afterEach(async () => {
    await pool.releaseAll()
    await removeTempDir(projectRoot)
  })

  const seedChannel = async (channelId: string, members: string[], opts?: {archived?: boolean}): Promise<void> => {
    const meta: ChannelMeta = {
      channelId,
      createdAt: '2026-05-17T12:00:00.000Z',
      members: members.map((handle) => ({
        acpVersion: '1',
        agentName: handle,
        capabilities: [],
        driverClass: 'C-prime',
        handle,
        invocation: {args: [], command: 'noop', cwd: '/tmp'},
        joinedAt: '2026-05-17T12:00:00.000Z',
        memberKind: 'acp-agent',
        status: 'idle',
      })),
      updatedAt: '2026-05-17T12:00:00.000Z',
    }
    if (opts?.archived) {
      meta.archivedAt = '2026-05-17T12:30:00.000Z'
    }

    await store.createChannel({meta, projectRoot})
  }

  it('spawns one driver per acp-agent member across all channels in the project', async () => {
    await seedChannel('ch-a', ['@kimi', '@codex'])
    await seedChannel('ch-b', ['@pi'])

    await orchestrator.warmDriversForProject(projectRoot)

    expect(constructedDrivers).to.have.length(3)
    expect(constructedDrivers.every((d) => d.startCount === 1)).to.equal(true)
    // All three should be in the pool.
    expect(pool.acquire({channelId: 'ch-a', memberHandle: '@kimi'})).to.not.equal(undefined)
    expect(pool.acquire({channelId: 'ch-a', memberHandle: '@codex'})).to.not.equal(undefined)
    expect(pool.acquire({channelId: 'ch-b', memberHandle: '@pi'})).to.not.equal(undefined)
  })

  it('skips members whose driver is already registered in the pool', async () => {
    await seedChannel('ch-a', ['@kimi'])
    // Pre-register a driver simulating a still-live invite.
    const existing = new MockAcpDriver({events: [], handle: '@kimi'})
    await existing.start()
    pool.register({channelId: 'ch-a', driver: existing})

    await orchestrator.warmDriversForProject(projectRoot)

    // Factory should NOT have been called for @kimi because the pool already has it.
    expect(constructedDrivers).to.have.length(0)
    // Existing driver is untouched.
    expect(pool.acquire({channelId: 'ch-a', memberHandle: '@kimi'})).to.equal(existing)
  })

  it('does NOT spawn drivers for archived channels (codex Q4)', async () => {
    await seedChannel('ch-archived', ['@kimi'], {archived: true})

    await orchestrator.warmDriversForProject(projectRoot)

    expect(constructedDrivers, 'archived channels must be skipped by listChannels').to.have.length(0)
  })

  it('deduplicates concurrent warmDriversForProject calls per (channelId, memberHandle) — codex Q6 in-flight guard', async () => {
    await seedChannel('ch-a', ['@kimi'])

    // Fire two concurrent warms — only ONE spawn should happen.
    await Promise.all([
      orchestrator.warmDriversForProject(projectRoot),
      orchestrator.warmDriversForProject(projectRoot),
    ])

    expect(constructedDrivers, 'concurrent warms must dedupe via warmInFlight').to.have.length(1)
  })

  it('one member failing does not prevent other members from warming (Promise.allSettled)', async () => {
    // We can't easily make CountingDriver.start() throw without breaking the
    // shared class — instead, force a failure via a one-shot driverFactory swap.
    // Re-wire the orchestrator with a mixed factory: first call throws, rest succeed.
    let calls = 0
    const flakyOrchestrator = new ChannelOrchestrator({
      broadcaster: {broadcastToChannel() {}},
      cancelCoordinator: new CancelCoordinator({broker, pool, seqAllocator: new TurnSequenceAllocator(), async writeEvent() {}}),
      clock: () => new Date('2026-05-17T12:00:00.000Z'),
      driverFactory(_invocation, handle) {
        calls += 1
        const driver = new CountingDriver(handle)
        constructedDrivers.push(driver)
        if (handle === '@kimi') {
          // Override start to throw for kimi only.
          driver.start = async () => {
            throw new Error('mock: kimi acp binary missing')
          }
        }

        return driver
      },
      idGenerator: () => `id-${calls}`,
      permissionBroker: broker,
      pool,
      seqAllocator: new TurnSequenceAllocator(),
      store,
    })

    await seedChannel('ch-a', ['@kimi', '@codex'])

    await flakyOrchestrator.warmDriversForProject(projectRoot)

    // Both drivers were instantiated, but only @codex registered.
    expect(constructedDrivers).to.have.length(2)
    expect(pool.acquire({channelId: 'ch-a', memberHandle: '@kimi'}), '@kimi spawn failed — must NOT be in pool').to.equal(undefined)
    expect(pool.acquire({channelId: 'ch-a', memberHandle: '@codex'}), '@codex must be in pool despite @kimi failing').to.not.equal(undefined)
  })

  it('post-spawn re-check: if channel is archived during spawn handshake, stop the fresh driver and skip registration (codex Q4 race)', async () => {
    // We seed the channel non-archived, then archive it WHILE the start() call
    // is in-flight. We simulate this with a slow-start driver that lets us
    // archive in between factory() and the warm's post-spawn re-check.
    let archiveAfterFactory = false
    let archivePromise: Promise<void> | undefined

    const orchestratorWithSlow = new ChannelOrchestrator({
      broadcaster: {broadcastToChannel() {}},
      cancelCoordinator: new CancelCoordinator({broker, pool, seqAllocator: new TurnSequenceAllocator(), async writeEvent() {}}),
      clock: () => new Date('2026-05-17T12:00:00.000Z'),
      driverFactory(_invocation, handle) {
        const driver = new CountingDriver(handle)
        constructedDrivers.push(driver)
        const originalStart = driver.start.bind(driver)
        driver.start = async () => {
          await originalStart()
          // Trigger archive AFTER start completes so the post-spawn re-check
          // sees an archived channel.
          if (archiveAfterFactory && archivePromise === undefined) {
            archivePromise = orchestratorWithSlow.archiveChannel({channelId: 'ch-race', projectRoot}).then(() => {})
            await archivePromise
          }
        }

        return driver
      },
      idGenerator: () => `id-race`,
      permissionBroker: broker,
      pool,
      seqAllocator: new TurnSequenceAllocator(),
      store,
    })

    await seedChannel('ch-race', ['@kimi'])
    archiveAfterFactory = true

    await orchestratorWithSlow.warmDriversForProject(projectRoot)

    // Channel was archived mid-spawn. The driver should be stopped and NOT registered.
    const driver = constructedDrivers.at(-1)
    expect(driver, 'driver was constructed').to.not.equal(undefined)
    expect(driver?.stopCount, 'post-spawn re-check must stop driver if channel archived').to.be.greaterThanOrEqual(1)
    expect(pool.acquire({channelId: 'ch-race', memberHandle: '@kimi'}), 'archived channel must NOT have driver in pool').to.equal(undefined)
  })
})
