import {expect} from 'chai'
import {createSandbox, type SinonSandbox} from 'sinon'

import type {TurnEvent} from '../../../../../src/shared/types/channel.js'

import {
  AcpHandshakeFailedError,
  ChannelInvalidRequestError,
} from '../../../../../src/server/core/domain/channel/errors.js'
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
import {ChannelEvents} from '../../../../../src/shared/transport/events/channel-events.js'
import {makeTempContextTree} from '../../../../helpers/temp-context-tree.js'
import {removeTempDir} from '../../../../helpers/temp-dir.js'

// Slice 2.4 — Phase-2 orchestrator extensions: inviteMember, uninviteMember,
// dispatchMention, cancelTurn, permissionDecision. The orchestrator wires
// the Slice 2.0/2.2/2.3 helpers + pool + broker + cancel coordinator into
// the active-dispatch lifecycle described in IMPLEMENTATION_PHASE_2.md §2.4.

describe('ChannelOrchestrator (Phase 2)', () => {
  let projectRoot: string
  let store: ChannelStore
  let orchestrator: ChannelOrchestrator
  let pool: AcpDriverPool
  let broker: PermissionBroker
  let broadcasts: Array<{channelId: string; event: string; payload: unknown}>
  let driversCreated: MockAcpDriver[]
  let nextDriverConfig: MockAcpDriver['protocolVersion'] | undefined
  let nextDriver: MockAcpDriver | undefined
  let sandbox: SinonSandbox
  const channelId = 'pi-test'

  const broadcaster = {
    broadcastToChannel(channelId: string, event: string, payload: unknown) {
      broadcasts.push({channelId, event, payload})
    },
  }

  beforeEach(async () => {
    sandbox = createSandbox()
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
    broadcasts = []
    driversCreated = []
    nextDriverConfig = undefined
    nextDriver = undefined

    let idCounter = 0
    const idGenerator = () => `id-${++idCounter}`

    const seqAllocator = new TurnSequenceAllocator()
    const cancelCoordinator = new CancelCoordinator({
      broker,
      pool,
      seqAllocator,
      async writeEvent(event, ctx) {
        await store.appendTurnEvent({channelId: ctx.channelId, event, projectRoot: ctx.projectRoot, turnId: ctx.turnId})
        broadcaster.broadcastToChannel(ctx.channelId, ChannelEvents.TURN_EVENT, {channelId: ctx.channelId, event})
      },
    })

    orchestrator = new ChannelOrchestrator({
      broadcaster,
      cancelCoordinator,
      clock: () => new Date('2026-05-11T00:00:00.000Z'),
      driverFactory(_invocation, handle) {
        const driver = nextDriver ?? new MockAcpDriver({events: [], handle, protocolVersion: nextDriverConfig})
        driversCreated.push(driver)
        return driver
      },
      idGenerator,
      permissionBroker: broker,
      pool,
      seqAllocator,
      store,
    })
  })

  afterEach(async () => {
    sandbox.restore()
    await pool.releaseAll()
    await removeTempDir(projectRoot)
  })

  const createChannel = async (): Promise<void> => {
    await orchestrator.createChannel({channelId, projectRoot})
  }

  const invite = async (handle = '@mock'): Promise<void> => {
    await orchestrator.inviteMember({
      channelId,
      handle,
      invocation: {args: [], command: 'noop', cwd: projectRoot},
      projectRoot,
    })
  }

  describe('inviteMember', () => {
    it('spawns + starts the driver, persists the member, returns a ChannelMember', async () => {
      await createChannel()
      const member = await orchestrator.inviteMember({
        channelId,
        handle: '@mock',
        invocation: {args: [], command: 'noop', cwd: projectRoot},
        projectRoot,
      })

      expect(member.handle).to.equal('@mock')
      expect(member.memberKind).to.equal('acp-agent')
      if (member.memberKind !== 'acp-agent') throw new Error('unreachable')
      expect(member.driverClass).to.equal('C-prime')
      expect(driversCreated).to.have.lengthOf(1)
      expect(pool.acquire({channelId, memberHandle: '@mock'})).to.equal(driversCreated[0])

      // Member persisted to meta.json.
      const meta = await store.readChannelMeta({channelId, projectRoot})
      expect(meta?.members).to.have.lengthOf(1)

      // member-update broadcast.
      expect(
        broadcasts.some(
          (b) => b.event === ChannelEvents.MEMBER_UPDATE && (b.payload as {op: string}).op === 'added',
        ),
      ).to.equal(true)
    })

    it('rejects profileName with CHANNEL_INVALID_REQUEST (Phase 3 introduces the registry)', async () => {
      await createChannel()
      try {
        await orchestrator.inviteMember({
          channelId,
          handle: '@mock',
          profileName: 'some-profile',
          projectRoot,
        })
        expect.fail('expected ChannelInvalidRequestError')
      } catch (error) {
        expect(error).to.be.instanceOf(ChannelInvalidRequestError)
      }
    })

    it('throws AcpHandshakeFailedError and does NOT persist a member when start() fails', async () => {
      await createChannel()
      const badDriver = new MockAcpDriver({events: [], handle: '@bad'})
      sandbox.stub(badDriver, 'start').rejects(new AcpHandshakeFailedError('@bad', 'boom'))
      nextDriver = badDriver

      try {
        await orchestrator.inviteMember({
          channelId,
          handle: '@bad',
          invocation: {args: [], command: 'noop', cwd: projectRoot},
          projectRoot,
        })
        expect.fail('expected AcpHandshakeFailedError')
      } catch (error) {
        expect(error).to.be.instanceOf(AcpHandshakeFailedError)
      }

      const meta = await store.readChannelMeta({channelId, projectRoot})
      expect(meta?.members).to.deep.equal([])
    })
  })

  describe('dispatchMention', () => {
    it('emits seq-0 user message, dispatched state, returns synchronously, streams in background', async () => {
      await createChannel()
      const driver = new MockAcpDriver({
        events: [
          {content: 'reply chunk', kind: 'agent_message_chunk'},
        ],
        handle: '@mock',
      })
      nextDriver = driver
      await invite('@mock')

      const accepted = await orchestrator.dispatchMention({
        channelId,
        projectRoot,
        prompt: '@mock hello',
      })

      // Synchronous return: turn is `dispatched`, delivery is `dispatched`.
      expect(accepted.turn.state).to.equal('dispatched')
      expect(accepted.deliveries).to.have.lengthOf(1)
      expect(accepted.deliveries[0].state).to.equal('dispatched')

      // events.jsonl received: seq-0 message, then turn_state_change pending→dispatched,
      // then delivery_state_change queued→dispatched.
      const {turnId} = accepted.turn
      const treeReader = new ChannelTreeReader()
      const events = await treeReader.readEvents({channelId, projectRoot, turnId})
      expect(events.length).to.be.greaterThan(2)
      expect(events[0].kind).to.equal('message')
      expect(events[0].seq).to.equal(0)
      expect(events[1].kind).to.equal('turn_state_change')
      expect((events[1] as {to: string}).to).to.equal('dispatched')
      expect(events[2].kind).to.equal('delivery_state_change')
      expect((events[2] as {to: string}).to).to.equal('dispatched')

      // Wait for the background task to complete.
      await new Promise((r) => {
        setTimeout(r, 100)
      })
      const finalEvents = await treeReader.readEvents({channelId, projectRoot, turnId})
      expect(finalEvents.some((e) => e.kind === 'agent_message_chunk')).to.equal(true)
      expect(finalEvents.some((e) => e.kind === 'turn_state_change' && (e as Extract<TurnEvent, {kind: 'turn_state_change'}>).to === 'completed')).to.equal(true)
    })

    it('rejects effective mention set > 1 with CHANNEL_INVALID_REQUEST', async () => {
      await createChannel()
      await invite('@a')
      await invite('@b')

      try {
        await orchestrator.dispatchMention({channelId, projectRoot, prompt: '@a @b ping'})
        expect.fail('expected ChannelInvalidRequestError')
      } catch (error) {
        expect(error).to.be.instanceOf(ChannelInvalidRequestError)
        expect((error as Error).message).to.match(/multi-agent|Phase 3/i)
      }
    })

    it('rejects an empty mention list with CHANNEL_MENTION_EMPTY', async () => {
      await createChannel()
      await invite('@mock')

      try {
        await orchestrator.dispatchMention({channelId, projectRoot, prompt: 'hello (no mentions)'})
        expect.fail('expected ChannelMentionEmptyError')
      } catch (error) {
        expect((error as Error).message).to.match(/no resolvable mentions/i)
      }
    })
  })

  describe('permissionDecision', () => {
    it('routes the decision through the broker and emits awaiting_permission → streaming', async () => {
      await createChannel()
      const driver = new MockAcpDriver({
        events: [
          {
            kind: 'permission_request',
            permissionRequestId: 'p-1',
            request: {
              options: [{kind: 'allow_once', name: 'Allow', optionId: 'opt-allow'}],
              sessionId: 's',
              toolCall: {toolCallId: 'tc-1'},
            },
          },
          {content: 'after permission', kind: 'agent_message_chunk'},
        ],
        handle: '@mock',
      })
      nextDriver = driver
      await invite('@mock')

      const accepted = await orchestrator.dispatchMention({channelId, projectRoot, prompt: '@mock do thing'})
      const {turnId} = accepted.turn

      // Wait for the permission_request event to land in events.jsonl.
      const treeReader = new ChannelTreeReader()
      const deadline = Date.now() + 5000
      let permissionRequestId: string | undefined
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        const events = await treeReader.readEvents({channelId, projectRoot, turnId})
        const found = events.find((e): e is Extract<TurnEvent, {kind: 'permission_request'}> => e.kind === 'permission_request')
        if (found !== undefined) {
          permissionRequestId = found.permissionRequestId
          break
        }

        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => {
          setTimeout(r, 20)
        })
      }

      expect(permissionRequestId, 'permission_request event must appear in events.jsonl').to.not.equal(undefined)

      await orchestrator.permissionDecision({
        channelId,
        outcome: {optionId: 'opt-allow', outcome: 'selected'},
        permissionRequestId: permissionRequestId!,
        projectRoot,
        turnId,
      })

      // Wait for completion.
      const completionDeadline = Date.now() + 5000
      let completed = false
      while (Date.now() < completionDeadline) {
        // eslint-disable-next-line no-await-in-loop
        const events = await treeReader.readEvents({channelId, projectRoot, turnId})
        if (events.some((e) => e.kind === 'turn_state_change' && (e as Extract<TurnEvent, {kind: 'turn_state_change'}>).to === 'completed')) {
          completed = true
          break
        }

        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => {
          setTimeout(r, 20)
        })
      }

      expect(completed, 'turn must reach completed state after permission resolves').to.equal(true)

      const events = await treeReader.readEvents({channelId, projectRoot, turnId})
      const transitions = events.filter((e) => e.kind === 'delivery_state_change').map((e) => `${(e as Extract<TurnEvent, {kind: 'delivery_state_change'}>).from}→${(e as Extract<TurnEvent, {kind: 'delivery_state_change'}>).to}`)
      expect(transitions).to.include('streaming→awaiting_permission')
      expect(transitions).to.include('awaiting_permission→streaming')
      expect(transitions).to.include('streaming→completed')
    })
  })

  describe('cancelTurn', () => {
    it('emits §7.2 sequence in events.jsonl: permission_decision → delivery_state_change → turn_state_change', async () => {
      await createChannel()
      const driver = new MockAcpDriver({
        events: [
          {
            kind: 'permission_request',
            permissionRequestId: 'p-cancel',
            request: {
              options: [{kind: 'allow_once', name: 'Allow', optionId: 'opt-allow'}],
              sessionId: 's',
              toolCall: {toolCallId: 'tc-1'},
            },
          },
        ],
        handle: '@mock',
      })
      nextDriver = driver
      await invite('@mock')

      const accepted = await orchestrator.dispatchMention({channelId, projectRoot, prompt: '@mock long task'})
      const {turnId} = accepted.turn

      // Wait for permission_request before cancelling.
      const treeReader = new ChannelTreeReader()
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        const events = await treeReader.readEvents({channelId, projectRoot, turnId})
        if (events.some((e) => e.kind === 'permission_request')) break
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => {
          setTimeout(r, 20)
        })
      }

      await orchestrator.cancelTurn({channelId, projectRoot, turnId})

      // Wait for terminal.
      const terminalDeadline = Date.now() + 5000
      while (Date.now() < terminalDeadline) {
        // eslint-disable-next-line no-await-in-loop
        const events = await treeReader.readEvents({channelId, projectRoot, turnId})
        if (events.some((e) => e.kind === 'turn_state_change' && (e as Extract<TurnEvent, {kind: 'turn_state_change'}>).to === 'cancelled')) {
          break
        }

        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => {
          setTimeout(r, 20)
        })
      }

      const events = await treeReader.readEvents({channelId, projectRoot, turnId})
      const cancelSequence = events.filter(
        (e) =>
          (e.kind === 'permission_decision' && (e as Extract<TurnEvent, {kind: 'permission_decision'}>).outcome.outcome === 'cancelled') ||
          (e.kind === 'delivery_state_change' && (e as Extract<TurnEvent, {kind: 'delivery_state_change'}>).to === 'cancelled') ||
          (e.kind === 'turn_state_change' && (e as Extract<TurnEvent, {kind: 'turn_state_change'}>).to === 'cancelled'),
      )

      const kinds = cancelSequence.map((e) => e.kind)
      const permIdx = kinds.indexOf('permission_decision')
      const delIdx = kinds.indexOf('delivery_state_change')
      const turnIdx = kinds.indexOf('turn_state_change')
      expect(permIdx).to.be.greaterThan(-1)
      expect(delIdx).to.be.greaterThan(permIdx)
      expect(turnIdx).to.be.greaterThan(delIdx)
    })
  })

  describe('uninviteMember', () => {
    it('removes the member from meta.json and stops the driver', async () => {
      await createChannel()
      const driver = new MockAcpDriver({events: [], handle: '@mock'})
      const stopSpy = sandbox.spy(driver, 'stop')
      nextDriver = driver
      await invite('@mock')

      await orchestrator.uninviteMember({channelId, memberHandle: '@mock', projectRoot})

      const meta = await store.readChannelMeta({channelId, projectRoot})
      expect(meta?.members).to.deep.equal([])
      expect(stopSpy.called).to.equal(true)
      expect(pool.acquire({channelId, memberHandle: '@mock'})).to.equal(undefined)

      expect(
        broadcasts.some(
          (b) => b.event === ChannelEvents.MEMBER_UPDATE && (b.payload as {op: string}).op === 'removed',
        ),
      ).to.equal(true)
    })
  })

  // Suppress "unused" reference to nextDriverConfig until Phase 3 widens the
  // driver factory contract.
  it('keeps nextDriverConfig in scope for future tests', () => {
    expect(typeof nextDriverConfig).to.equal('undefined')
  })
})
