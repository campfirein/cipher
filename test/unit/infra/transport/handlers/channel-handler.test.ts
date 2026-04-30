import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {ChannelAgentDriver} from '../../../../../src/server/infra/channel/drivers/types.js'
import type {
  ChannelArchiveRequestT,
  ChannelCreateRequestT,
  ChannelGetRequestT,
  ChannelInviteRequestT,
  ChannelLeaveRequestT,
  ChannelListResponseT,
  ChannelMembersRequestT,
  ChannelMentionRequestT,
  ChannelMuteRequestT,
} from '../../../../../src/shared/transport/events/channel-events.js'

import {MockChannelAgentDriver} from '../../../../../src/server/infra/channel/drivers/mock-driver.js'
import {ChannelOrchestrator} from '../../../../../src/server/infra/channel/orchestrator.js'
import {LookbackBuilder} from '../../../../../src/server/infra/channel/storage/lookback-builder.js'
import {FileTreeReader} from '../../../../../src/server/infra/channel/storage/tree-reader.js'
import {FileTreeWriter} from '../../../../../src/server/infra/channel/storage/tree-writer.js'
import {WriteSerializer} from '../../../../../src/server/infra/channel/storage/write-serializer.js'
import {ChannelHandler} from '../../../../../src/server/infra/transport/handlers/channel-handler.js'
import {ChannelEvents} from '../../../../../src/shared/transport/events/channel-events.js'
import {createMockTransportServer, type MockTransportServer} from '../../../../helpers/mock-factories.js'

describe('ChannelHandler', () => {
  let tempRoot: string
  let writer: FileTreeWriter
  let reader: FileTreeReader
  let transport: MockTransportServer
  let driverFactory: (agentId: string) => ChannelAgentDriver

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'brv-channel-handler-'))
    writer = new FileTreeWriter()
    reader = new FileTreeReader(tempRoot)
    driverFactory = () => new MockChannelAgentDriver({scenario: 'echo'})
    transport = createMockTransportServer()

    const orchestrator = new ChannelOrchestrator({
      driverFor: (agentId) => driverFactory(agentId),
      lookbackBuilder: new LookbackBuilder(reader),
      publish() {/* no-op for handler tests */},
      reader,
      serializer: new WriteSerializer(),
      writer,
    })

    const handler = new ChannelHandler({orchestrator, reader, transport, writer})
    handler.setup()
  })

  afterEach(async () => {
    await rm(tempRoot, {force: true, recursive: true})
  })

  type AnyHandler = (data: unknown, clientId?: string) => Promise<unknown>

  function call<T>(event: string, payload?: unknown): Promise<T> {
    const fn = transport._handlers.get(event) as AnyHandler | undefined
    if (!fn) throw new Error(`no handler registered for ${event}`)
    return fn(payload, 'test-client') as Promise<T>
  }

  it('registers a handler for every Phase 1 channel:* request event', () => {
    // Phase 1 wires the management + turn surface. PERMISSION_DECISION (F2) is wired in Phase 2
    // alongside real ACP drivers; ARTIFACT_DIFF (F6) is wired in Phase 5 with the full conflict UX.
    // Notification events (TURN_EVENT, PERMISSION_PROMPT, ARTIFACT_*) are server→client broadcasts,
    // not request/response handlers — they ride `transport.broadcast()` and have no `onRequest` slot.
    const phase1Requests = [
      ChannelEvents.ARCHIVE,
      ChannelEvents.CANCEL,
      ChannelEvents.CREATE,
      ChannelEvents.GET,
      ChannelEvents.INVITE,
      ChannelEvents.JOIN,
      ChannelEvents.LEAVE,
      ChannelEvents.LIST,
      ChannelEvents.MEMBERS,
      ChannelEvents.MENTION,
      ChannelEvents.MUTE,
    ]
    for (const event of phase1Requests) {
      expect(transport._handlers.has(event), `missing handler for ${event}`).to.equal(true)
    }
  })

  it('CREATE writes a meta.json and returns the new meta', async () => {
    const res = await call<{meta: {channelId: string; status: string}}>(ChannelEvents.CREATE, {
      channelId: 'test-channel',
      scope: 'project',
      treeRootHint: tempRoot,
    } satisfies ChannelCreateRequestT)

    expect(res.meta.channelId).to.equal('test-channel')
    expect(res.meta.status).to.equal('active')
  })

  it('GET returns null for a missing channel', async () => {
    const res = await call<{meta: null}>(ChannelEvents.GET, {channelId: 'no-such-channel'} satisfies ChannelGetRequestT)
    expect(res.meta).to.equal(null)
  })

  it('LIST returns all channels', async () => {
    await call(ChannelEvents.CREATE, {channelId: 'one', scope: 'project', treeRootHint: tempRoot} satisfies ChannelCreateRequestT)
    await call(ChannelEvents.CREATE, {channelId: 'two', scope: 'project', treeRootHint: tempRoot} satisfies ChannelCreateRequestT)

    const res = await call<ChannelListResponseT>(ChannelEvents.LIST)
    expect(res.channels.map((c) => c.channelId).sort()).to.deep.equal(['one', 'two'])
  })

  it('INVITE adds members idempotently', async () => {
    await call(ChannelEvents.CREATE, {channelId: 'inv', scope: 'project', treeRootHint: tempRoot} satisfies ChannelCreateRequestT)

    const inviteRes = await call<{meta: {members: Array<{agentId: string}>}}>(ChannelEvents.INVITE, {
      agents: [{displayName: 'Mock A', id: 'mock-a', launch: {kind: 'mock', mockId: 'echo'}, role: 'coding-agent'}],
      channelId: 'inv',
    } satisfies ChannelInviteRequestT)
    expect(inviteRes.meta.members.map((m) => m.agentId)).to.deep.equal(['mock-a'])

    // re-invite is idempotent
    const inviteAgain = await call<{meta: {members: Array<{agentId: string}>}}>(ChannelEvents.INVITE, {
      agents: [{displayName: 'Mock A', id: 'mock-a', launch: {kind: 'mock', mockId: 'echo'}, role: 'coding-agent'}],
      channelId: 'inv',
    } satisfies ChannelInviteRequestT)
    expect(inviteAgain.meta.members).to.have.length(1)
  })

  it('LEAVE marks the member as left', async () => {
    await call(ChannelEvents.CREATE, {channelId: 'leave-test', scope: 'project', treeRootHint: tempRoot} satisfies ChannelCreateRequestT)
    await call(ChannelEvents.INVITE, {
      agents: [{displayName: 'Mock A', id: 'mock-a', launch: {kind: 'mock', mockId: 'echo'}, role: 'coding-agent'}],
      channelId: 'leave-test',
    } satisfies ChannelInviteRequestT)

    const res = await call<{meta: {members: Array<{agentId: string; status: string}>}}>(ChannelEvents.LEAVE, {
      agentId: 'mock-a',
      channelId: 'leave-test',
    } satisfies ChannelLeaveRequestT)
    expect(res.meta.members[0].status).to.equal('left')
  })

  it('MUTE toggles member status to muted/idle', async () => {
    await call(ChannelEvents.CREATE, {channelId: 'mute-test', scope: 'project', treeRootHint: tempRoot} satisfies ChannelCreateRequestT)
    await call(ChannelEvents.INVITE, {
      agents: [{displayName: 'Mock A', id: 'mock-a', launch: {kind: 'mock', mockId: 'echo'}, role: 'coding-agent'}],
      channelId: 'mute-test',
    } satisfies ChannelInviteRequestT)

    const muted = await call<{meta: {members: Array<{status: string}>}}>(ChannelEvents.MUTE, {
      agentId: 'mock-a',
      channelId: 'mute-test',
      muted: true,
    } satisfies ChannelMuteRequestT)
    expect(muted.meta.members[0].status).to.equal('muted')

    const unmuted = await call<{meta: {members: Array<{status: string}>}}>(ChannelEvents.MUTE, {
      agentId: 'mock-a',
      channelId: 'mute-test',
      muted: false,
    } satisfies ChannelMuteRequestT)
    expect(unmuted.meta.members[0].status).to.equal('idle')
  })

  it('MEMBERS returns the current member list', async () => {
    await call(ChannelEvents.CREATE, {channelId: 'mem-test', scope: 'project', treeRootHint: tempRoot} satisfies ChannelCreateRequestT)
    await call(ChannelEvents.INVITE, {
      agents: [{displayName: 'Mock A', id: 'mock-a', launch: {kind: 'mock', mockId: 'echo'}, role: 'coding-agent'}],
      channelId: 'mem-test',
    } satisfies ChannelInviteRequestT)

    const res = await call<{members: Array<{agentId: string}>}>(ChannelEvents.MEMBERS, {
      channelId: 'mem-test',
    } satisfies ChannelMembersRequestT)
    expect(res.members.map((m) => m.agentId)).to.deep.equal(['mock-a'])
  })

  it('MENTION runs the orchestrator and returns turns', async () => {
    await call(ChannelEvents.CREATE, {channelId: 'mention-test', scope: 'project', treeRootHint: tempRoot} satisfies ChannelCreateRequestT)
    await call(ChannelEvents.INVITE, {
      agents: [{displayName: 'Mock A', id: 'mock-a', launch: {kind: 'mock', mockId: 'echo'}, role: 'coding-agent'}],
      channelId: 'mention-test',
    } satisfies ChannelInviteRequestT)

    const res = await call<{turns: Array<{state: string}>}>(ChannelEvents.MENTION, {
      channelId: 'mention-test',
      prompt: '@mock-a hello',
    } satisfies ChannelMentionRequestT)
    expect(res.turns).to.have.length(1)
    expect(res.turns[0].state).to.equal('completed')
  })

  it('ARCHIVE flips status to archived', async () => {
    await call(ChannelEvents.CREATE, {channelId: 'arch', scope: 'project', treeRootHint: tempRoot} satisfies ChannelCreateRequestT)
    const res = await call<{meta: {status: string}}>(ChannelEvents.ARCHIVE, {channelId: 'arch'} satisfies ChannelArchiveRequestT)
    expect(res.meta.status).to.equal('archived')
  })

  it('JOIN returns the Phase 3 stub message', async () => {
    await call(ChannelEvents.CREATE, {channelId: 'join-test', scope: 'project', treeRootHint: tempRoot} satisfies ChannelCreateRequestT)
    const res = await call<{message: string}>(ChannelEvents.JOIN, {channelId: 'join-test'})
    expect(res.message).to.match(/phase 3/i)
  })

  // Codex F1 + Kimi B2 — when wired with a PermissionBroker, GET surfaces parked permissions
  // and PERMISSION_DECISION resolves them. Tested as a separate describe so we can supply a broker.
  describe('with PermissionBroker wired', () => {
    it('GET includes pendingPermissions; PERMISSION_DECISION resolves a parked permission', async () => {
      const {PermissionBroker} = await import('../../../../../src/server/infra/channel/drivers/permission-broker.js')
      const broker = new PermissionBroker(60_000)
      const localTransport = createMockTransportServer()
      const orchestrator = new ChannelOrchestrator({
        driverFor: () => new MockChannelAgentDriver({scenario: 'echo'}),
        lookbackBuilder: new LookbackBuilder(reader),
        publish() {/* no-op */},
        reader,
        serializer: new WriteSerializer(),
        writer,
      })
      const handler = new ChannelHandler({
        orchestrator,
        permissionBroker: broker,
        reader,
        transport: localTransport,
        writer,
      })
      handler.setup()

      // Park a permission via the broker so GET has something to surface.
      const parked = broker.parkAndAwait('t-001', 'auth-rotation', {
        options: [
          {kind: 'allow_once', name: 'Allow', optionId: 'allow'},
          {kind: 'reject_once', name: 'Deny', optionId: 'deny'},
        ],
        sessionId: 'sess-x',
        toolCall: {kind: 'edit', rawInput: {}, status: 'pending', title: 'Edit src/auth.ts', toolCallId: 'tc-1'},
      })
      // Ignore the eventual rejection in case the test's decide() lands first.
      parked.catch(() => {})

      // Need a meta on disk for handleGet to find.
      await writer.writeMeta({
        channelId: 'auth-rotation',
        createdAt: new Date().toISOString(),
        members: [],
        scope: 'project',
        status: 'active',
        treeRoot: tempRoot,
        turnCount: 0,
      })

      const handlers = localTransport._handlers
      const getRes = await (handlers.get(ChannelEvents.GET)! as AnyHandler)({channelId: 'auth-rotation'}, 'test')
      expect(getRes).to.have.property('pendingPermissions')
      const pendingPerms = (getRes as {pendingPermissions: Array<{permissionRequestId: string; turnId: string;}>}).pendingPermissions
      expect(pendingPerms).to.have.length(1)
      expect(pendingPerms[0].turnId).to.equal('t-001')
      expect(pendingPerms[0].permissionRequestId).to.equal('tc-1')

      const decisionRes = await (handlers.get(ChannelEvents.PERMISSION_DECISION)! as AnyHandler)({
        channelId: 'auth-rotation',
        decision: 'allow',
        permissionRequestId: 'tc-1',
        turnId: 't-001',
      }, 'test')
      expect((decisionRes as {resumedState: string}).resumedState).to.equal('in_flight')

      // The parked Promise must have resolved with the broker's translated SDK shape.
      const result = await parked
      expect(result.denied).to.equal(false)
      expect(result.response.outcome.outcome).to.equal('selected')
    })

    // Codex re-review (round 3) Finding 1 — the handler's PERMISSION_DECISION translates a
    // `'deny'` decision into the right `optionId` by kind, even when the vendor uses non-literal IDs.
    it('PERMISSION_DECISION resolves deny to the reject option by kind, not by literal optionId', async () => {
      const {PermissionBroker} = await import('../../../../../src/server/infra/channel/drivers/permission-broker.js')
      const broker = new PermissionBroker(60_000)
      const localTransport = createMockTransportServer()
      const orchestrator = new ChannelOrchestrator({
        driverFor: () => new MockChannelAgentDriver({scenario: 'echo'}),
        lookbackBuilder: new LookbackBuilder(reader),
        publish() {/* no-op */},
        reader,
        serializer: new WriteSerializer(),
        writer,
      })
      const handler = new ChannelHandler({orchestrator, permissionBroker: broker, reader, transport: localTransport, writer})
      handler.setup()

      // Vendor-style options: arbitrary optionIds, classified only by kind.
      const parked = broker.parkAndAwait('t-vendor', 'auth-rotation', {
        options: [
          {kind: 'allow_once', name: 'Yes', optionId: 'yes_button'},
          {kind: 'reject_once', name: 'No', optionId: 'reject_once_99'},
        ],
        sessionId: 'sess-x',
        toolCall: {kind: 'edit', rawInput: {}, status: 'pending', title: 'Edit', toolCallId: 'tc-vendor'},
      })
      parked.catch(() => {})

      const handlers = localTransport._handlers
      const decisionRes = await (handlers.get(ChannelEvents.PERMISSION_DECISION)! as AnyHandler)({
        channelId: 'auth-rotation',
        decision: 'deny',
        permissionRequestId: 'tc-vendor',
        turnId: 't-vendor',
      }, 'test')
      expect((decisionRes as {resumedState: string}).resumedState).to.equal('failed')

      const result = await parked
      expect(result.denied).to.equal(true)
      if (result.response.outcome.outcome === 'selected') {
        expect(result.response.outcome.optionId).to.equal('reject_once_99')
      }
    })

    it('CANCEL returns cancelled:false when no turn is bound', async () => {
      const {CancelCoordinator} = await import('../../../../../src/server/infra/channel/drivers/cancel-coordinator.js')
      const localTransport = createMockTransportServer()
      const coordinator = new CancelCoordinator()
      const orchestrator = new ChannelOrchestrator({
        driverFor: () => new MockChannelAgentDriver({scenario: 'echo'}),
        lookbackBuilder: new LookbackBuilder(reader),
        publish() {/* no-op */},
        reader,
        serializer: new WriteSerializer(),
        writer,
      })
      const handler = new ChannelHandler({cancelCoordinator: coordinator, orchestrator, reader, transport: localTransport, writer})
      handler.setup()

      const handlers = localTransport._handlers
      const res = await (handlers.get(ChannelEvents.CANCEL)! as AnyHandler)({channelId: 'x', turnId: 'y'}, 'test')
      expect((res as {cancelled: boolean}).cancelled).to.equal(false)
    })
  })
})
