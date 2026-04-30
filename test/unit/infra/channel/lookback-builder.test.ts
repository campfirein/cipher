import {expect} from 'chai'

import type {
  ChannelMember,
  ChannelMeta,
  Turn,
  TurnState,
} from '../../../../src/server/core/domain/channel/types.js'
import type {DigestRef, TreeReader} from '../../../../src/server/infra/channel/storage/tree-reader.js'

import {
  enforceByteBudget,
  LookbackBuilder,
  toLookbackEntry,
  uniqueArtifacts,
} from '../../../../src/server/infra/channel/storage/lookback-builder.js'
import {channelMetaFixture} from '../../../helpers/channel-fixtures.js'

class FakeTreeReader implements TreeReader {
  constructor(
    private readonly turnsByAgent: Map<string, Turn[]>,
    private readonly digests: DigestRef[] = [],
  ) {}

  public async lastCompletedTurnFor(_meta: ChannelMeta, agentId: string): Promise<null | Turn> {
    const turns = this.turnsByAgent.get(agentId) ?? []
    const completed = turns.filter((turn) => turn.state === 'completed')
    return completed.at(-1) ?? null
  }

  public async listAllChannels(): Promise<ChannelMeta[]> {
    return [channelMetaFixture]
  }

  public async listDigests(_meta: ChannelMeta): Promise<DigestRef[]> {
    return this.digests
  }

  public async readMeta(_channelId: string): Promise<ChannelMeta | null> {
    return channelMetaFixture
  }

  public async readTurn(_meta: ChannelMeta, _turnId: string): Promise<null | Turn> {
    return null
  }

  public async turnsAfter(_meta: ChannelMeta, since: string): Promise<Turn[]> {
    const all: Turn[] = [...this.turnsByAgent.values()].flat()
    return all
      .filter((turn) => (turn.endedAt ?? turn.startedAt) > since)
      .sort((a, b) => a.turnId.localeCompare(b.turnId))
  }

  public async turnsInState(_meta: ChannelMeta, states: TurnState[]): Promise<Turn[]> {
    const all: Turn[] = [...this.turnsByAgent.values()].flat()
    return all.filter((turn) => states.includes(turn.state))
  }
}

function makeTurn(turnId: string, agentId: string, state: TurnState, opts: Partial<Turn> = {}): Turn {
  const startedAt = `2026-04-30T00:00:${turnId.slice(2).padStart(2, '0')}.000Z`
  const endedAt = `2026-04-30T00:00:${turnId.slice(2).padStart(2, '0')}.500Z`
  return {
    agentId,
    channelId: channelMetaFixture.channelId,
    promptText: `prompt for ${turnId}`,
    startedAt,
    state,
    turnId,
    ...(state === 'completed' ? {endedAt} : {}),
    ...opts,
  }
}

function memberOf(agentId: string): ChannelMember {
  return {
    agentId,
    joinedAt: channelMetaFixture.createdAt,
    status: 'idle',
  }
}

describe('LookbackBuilder', () => {
  it('returns null yourLastTurn and the full transcript for a first-time speaker', async () => {
    const t1 = makeTurn('t-001', 'b', 'completed')
    const t2 = makeTurn('t-002', 'b', 'completed')
    const reader = new FakeTreeReader(new Map([['b', [t1, t2]]]))
    const builder = new LookbackBuilder(reader)

    const packet = await builder.build(channelMetaFixture, memberOf('a'), 'first prompt for a')

    expect(packet.yourLastTurn).to.equal(null)
    expect(packet.sinceYourLastTurn).to.have.length(2)
    expect(packet.sinceYourLastTurn.map((entry) => entry.turnId)).to.deep.equal(['t-001', 't-002'])
    expect(packet.currentPrompt).to.equal('first prompt for a')
  })

  it('walks since-your-last-turn for an agent that already spoke', async () => {
    const a1 = makeTurn('t-001', 'a', 'completed')
    const b1 = makeTurn('t-002', 'b', 'completed')
    const b2 = makeTurn('t-003', 'b', 'completed')
    const reader = new FakeTreeReader(new Map([
      ['a', [a1]],
      ['b', [b1, b2]],
    ]))
    const builder = new LookbackBuilder(reader)

    const packet = await builder.build(channelMetaFixture, memberOf('a'), 'follow up')

    expect(packet.yourLastTurn?.turnId).to.equal('t-001')
    expect(packet.sinceYourLastTurn.map((entry) => entry.turnId)).to.deep.equal(['t-002', 't-003'])
    expect(packet.sinceYourLastTurn.every((entry) => entry.by !== '@a')).to.equal(true)
  })

  it('splices a digest entry replacing covered turns when the digest covers the window', async () => {
    const t1 = makeTurn('t-001', 'b', 'completed')
    const t2 = makeTurn('t-002', 'b', 'completed')
    const t3 = makeTurn('t-003', 'b', 'completed')
    const reader = new FakeTreeReader(
      new Map([['b', [t1, t2, t3]]]),
      [
        {
          coversThrough: 't-002',
          createdAt: '2026-04-30T00:00:10.000Z',
          id: 'digest-001',
          sourceTurnIds: ['t-001', 't-002'],
          summary: 'digest summary of two turns',
          version: 1,
        },
      ],
    )
    const builder = new LookbackBuilder(reader)

    const packet = await builder.build(channelMetaFixture, memberOf('a'), 'go')

    expect(packet.sinceYourLastTurn).to.have.length(2)
    expect(packet.sinceYourLastTurn[0]).to.include({
      by: '@system',
      kind: 'digest',
      turnId: 'digest-001',
    })
    expect(packet.sinceYourLastTurn[1].turnId).to.equal('t-003')
  })

  it('skips digest splice when the digest does not cover the agent lookback range', async () => {
    const olderTurn = makeTurn('t-005', 'a', 'completed')
    const newerB = makeTurn('t-006', 'b', 'completed')
    const reader = new FakeTreeReader(
      new Map([
        ['a', [olderTurn]],
        ['b', [newerB]],
      ]),
      [
        {
          coversThrough: 't-002',
          createdAt: '2026-04-30T00:00:01.000Z',
          id: 'digest-old',
          sourceTurnIds: ['t-001', 't-002'],
          summary: 'older digest',
          version: 1,
        },
      ],
    )
    const builder = new LookbackBuilder(reader)

    const packet = await builder.build(channelMetaFixture, memberOf('a'), 'go')

    expect(packet.sinceYourLastTurn).to.have.length(1)
    expect(packet.sinceYourLastTurn[0].kind).to.equal('message')
    expect(packet.sinceYourLastTurn[0].turnId).to.equal('t-006')
  })

  it('truncates summaries when the packet exceeds the byte budget', () => {
    const longSummary = 'x'.repeat(2000)
    const packet = {
      channelId: 'ping-pong',
      currentPrompt: 'hi',
      sharedArtifacts: [],
      sinceYourLastTurn: [
        {by: '@b', kind: 'message' as const, path: null, summary: longSummary, turnId: 't-001'},
        {by: '@b', kind: 'message' as const, path: null, summary: longSummary, turnId: 't-002'},
      ],
      yourLastTurn: null,
    }

    const constrained = enforceByteBudget(packet, 1500)
    const totalSummaryLen = constrained.sinceYourLastTurn.reduce((s, e) => s + e.summary.length, 0)
    expect(JSON.stringify(constrained).length).to.be.lessThanOrEqual(1600) // some slack for envelope
    expect(totalSummaryLen).to.be.lessThan(longSummary.length * 2)
  })

  it('projects artifacts via uniqueArtifacts with version=count', () => {
    const t1 = makeTurn('t-001', 'a', 'completed', {artifactsTouched: ['plan.md']})
    const t2 = makeTurn('t-002', 'a', 'completed', {artifactsTouched: ['plan.md']})
    const t3 = makeTurn('t-003', 'b', 'completed', {artifactsTouched: ['notes.md']})

    const out = uniqueArtifacts([t1, t2, t3])

    expect(out).to.have.length(2)
    const plan = out.find((a) => a.path === 'plan.md')
    const notes = out.find((a) => a.path === 'notes.md')
    expect(plan?.version).to.equal(2)
    expect(notes?.version).to.equal(1)
  })

  it('toLookbackEntry projects an artifact-touching turn as kind=artifact', () => {
    const turn = makeTurn('t-001', 'a', 'completed', {artifactsTouched: ['plan.md']})
    const entry = toLookbackEntry(turn)
    expect(entry.kind).to.equal('artifact')
    expect(entry.path).to.equal('plan.md')
  })
})
