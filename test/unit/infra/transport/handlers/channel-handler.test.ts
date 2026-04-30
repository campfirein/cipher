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
})
