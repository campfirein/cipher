import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {ChannelMember, ChannelMeta} from '../../../../src/server/core/domain/channel/types.js'
import type {ChannelAgentDriver} from '../../../../src/server/infra/channel/drivers/types.js'

import {MockChannelAgentDriver} from '../../../../src/server/infra/channel/drivers/mock-driver.js'
import {
  ChannelOrchestrator,
  parseMentions,
  stripMentions,
  type TurnEventNotification,
} from '../../../../src/server/infra/channel/orchestrator.js'
import {LookbackBuilder} from '../../../../src/server/infra/channel/storage/lookback-builder.js'
import {FileTreeReader} from '../../../../src/server/infra/channel/storage/tree-reader.js'
import {FileTreeWriter} from '../../../../src/server/infra/channel/storage/tree-writer.js'
import {WriteSerializer} from '../../../../src/server/infra/channel/storage/write-serializer.js'
import {channelMetaFixture} from '../../../helpers/channel-fixtures.js'

describe('ChannelOrchestrator', () => {
  let tempRoot: string
  let writer: FileTreeWriter
  let reader: FileTreeReader
  let serializer: WriteSerializer
  let lookbackBuilder: LookbackBuilder
  let publishedEvents: TurnEventNotification[]
  let driverFactory: (agentId: string) => ChannelAgentDriver

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'brv-channel-orch-'))
    writer = new FileTreeWriter()
    reader = new FileTreeReader(tempRoot)
    serializer = new WriteSerializer()
    lookbackBuilder = new LookbackBuilder(reader)
    publishedEvents = []
    driverFactory = (_agentId: string) => new MockChannelAgentDriver({scenario: 'echo'})

    const meta: ChannelMeta = {
      ...channelMetaFixture,
      members: [
        {agentId: 'mock-a', joinedAt: channelMetaFixture.createdAt, status: 'idle'},
        {agentId: 'mock-b', joinedAt: channelMetaFixture.createdAt, status: 'idle'},
      ],
      treeRoot: tempRoot,
      turnCount: 0,
    }
    await writer.writeMeta(meta)
  })

  afterEach(async () => {
    await rm(tempRoot, {force: true, recursive: true})
  })

  function makeOrchestrator(): ChannelOrchestrator {
    return new ChannelOrchestrator({
      driverFor: (agentId) => driverFactory(agentId),
      lookbackBuilder,
      publish: (channelId, ev) => publishedEvents.push(ev),
      reader,
      serializer,
      writer,
    })
  }

  it('runs a single turn through to completion', async () => {
    const orchestrator = makeOrchestrator()

    const turns = await orchestrator.mention({channelId: channelMetaFixture.channelId, prompt: '@mock-a hello'})

    expect(turns).to.have.length(1)
    expect(turns[0].state).to.equal('completed')
    expect(turns[0].agentId).to.equal('mock-a')
    expect(turns[0].endedAt).to.be.a('string')

    const persisted = await reader.readTurn({...channelMetaFixture, treeRoot: tempRoot}, turns[0].turnId)
    expect(persisted?.state).to.equal('completed')
  })

  it('runs two parallel turns from a multi-mention prompt', async () => {
    const orchestrator = makeOrchestrator()

    const turns = await orchestrator.mention({
      channelId: channelMetaFixture.channelId,
      prompt: '@mock-a @mock-b answer in unison',
    })

    expect(turns).to.have.length(2)
    expect(turns.every((t) => t.state === 'completed')).to.equal(true)
    const meta = await reader.readMeta(channelMetaFixture.channelId)
    expect(meta?.turnCount).to.equal(2)
  })

  it('marks a turn failed when the driver throws and writes an error event', async () => {
    driverFactory = () => new MockChannelAgentDriver({failAfterMs: 1, scenario: 'fail-after'})
    const orchestrator = makeOrchestrator()

    const turns = await orchestrator.mention({channelId: channelMetaFixture.channelId, prompt: '@mock-a do x'})

    expect(turns[0].state).to.equal('failed')
    expect(turns[0].endedAt).to.be.a('string')
  })

  it('publishes turn events to the in-process subscriber', async () => {
    const orchestrator = makeOrchestrator()

    await orchestrator.mention({channelId: channelMetaFixture.channelId, prompt: '@mock-a hello'})

    expect(publishedEvents.length).to.be.greaterThan(0)
    expect(publishedEvents.every((e) => e.channelId === channelMetaFixture.channelId)).to.equal(true)
    expect(publishedEvents.every((e) => e.type === 'turn-event')).to.equal(true)
  })

  it('returns no turns when the prompt mentions no installed members', async () => {
    const orchestrator = makeOrchestrator()
    const turns = await orchestrator.mention({channelId: channelMetaFixture.channelId, prompt: 'just a comment'})
    expect(turns).to.deep.equal([])
  })

  it('recoverChannelsOnStartup transitions in-flight turns to failed and resets member status', async () => {
    // Manually persist an in-flight turn and a thinking member.
    const meta = await reader.readMeta(channelMetaFixture.channelId)
    if (!meta) throw new Error('test fixture meta missing')

    meta.members[0].status = 'thinking'
    await writer.writeMeta(meta)

    await writer.writeTurnInitial(meta, {
      agentId: 'mock-a',
      channelId: meta.channelId,
      promptText: 'hello',
      startedAt: new Date().toISOString(),
      state: 'in_flight',
      turnId: 't-001',
    })

    const orchestrator = makeOrchestrator()
    await orchestrator.recoverChannelsOnStartup()

    const recovered = await reader.readTurn(meta, 't-001')
    expect(recovered?.state).to.equal('failed')
    expect(recovered?.endedAt).to.be.a('string')

    const reloaded = await reader.readMeta(channelMetaFixture.channelId)
    expect(reloaded?.members[0].status).to.equal('errored')
    expect(reloaded?.members[0].lastTurnAt).to.be.a('string')
  })

  describe('parseMentions / stripMentions helpers', () => {
    const members: ChannelMember[] = [
      {agentId: 'claude-code', joinedAt: '2026-04-30T00:00:00.000Z', status: 'idle'},
      {agentId: 'opencode', joinedAt: '2026-04-30T00:00:00.000Z', status: 'idle'},
    ]

    it('parseMentions resolves @-tokens against installed members only', () => {
      const resolved = parseMentions('@claude-code please plan; ignore @nonsense', members)
      expect(resolved.map((m) => m.agentId)).to.deep.equal(['claude-code'])
    })

    it('parseMentions deduplicates repeated mentions', () => {
      const resolved = parseMentions('@claude-code one @claude-code two', members)
      expect(resolved).to.have.length(1)
    })

    it('stripMentions removes resolved tokens and collapses whitespace', () => {
      const cleaned = stripMentions('@claude-code   please     plan @opencode', members)
      expect(cleaned).to.equal('please plan')
    })

    it('stripMentions keeps unresolved @-tokens intact', () => {
      const cleaned = stripMentions('@nonsense hi @claude-code', members)
      expect(cleaned).to.equal('@nonsense hi')
    })
  })
})
