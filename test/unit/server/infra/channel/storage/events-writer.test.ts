import {expect} from 'chai'
import {promises as fs} from 'node:fs'

import type {TurnEvent} from '../../../../../../src/shared/types/channel.js'

import {ChannelEventsWriter} from '../../../../../../src/server/infra/channel/storage/events-writer.js'
import {channelPaths} from '../../../../../../src/server/infra/channel/storage/paths.js'
import {ChannelWriteSerializer} from '../../../../../../src/server/infra/channel/storage/write-serializer.js'
import {makeTempContextTree} from '../../../../../helpers/temp-context-tree.js'
import {removeTempDir} from '../../../../../helpers/temp-dir.js'

// Slice 1.3 — append-only events.jsonl writer with monotonic per-turn seq.
// Implements the "source of truth" half of CHANNEL_PROTOCOL.md §4.2.
describe('ChannelEventsWriter', () => {
  let projectRoot: string
  let writer: ChannelEventsWriter
  const channelId = 'pi-test'
  const turnId = '01HX'

  const makeEvent = (overrides: Partial<TurnEvent> = {}): TurnEvent =>
    ({
      channelId,
      deliveryId: null,
      emittedAt: '2026-05-11T00:00:00.000Z',
      from: 'pending',
      kind: 'turn_state_change',
      memberHandle: null,
      seq: 0,
      to: 'completed',
      turnId,
      ...overrides,
    } as TurnEvent)

  beforeEach(async () => {
    projectRoot = await makeTempContextTree()
    writer = new ChannelEventsWriter({serializer: new ChannelWriteSerializer()})
  })

  afterEach(async () => {
    await removeTempDir(projectRoot)
  })

  it('creates the per-turn NDJSON on first append and ensures the parent directory', async () => {
    // Slice 9.1: writes go to .brv/channel-history/<ch>/turns/<turn>.ndjson
    // (NOT the legacy .brv/context-tree/channel/<ch>/turns/<turn>/events.jsonl).
    await writer.append({channelId, event: makeEvent(), projectRoot, turnId})
    const file = channelPaths.turnNdjsonFile(projectRoot, channelId, turnId)
    const contents = await fs.readFile(file, 'utf8')
    expect(contents.trim().split('\n')).to.have.lengthOf(1)
  })

  it('does NOT write to the legacy events.jsonl location (Slice 9.1)', async () => {
    await writer.append({channelId, event: makeEvent(), projectRoot, turnId})
    const legacyFile = channelPaths.eventsFile(projectRoot, channelId, turnId)
    let legacyExists = true
    try {
      await fs.stat(legacyFile)
    } catch {
      legacyExists = false
    }

    expect(legacyExists, 'legacy events.jsonl must not be created').to.equal(false)
  })

  it('appends multiple events as newline-delimited JSON', async () => {
    await writer.append({channelId, event: makeEvent({seq: 0}), projectRoot, turnId})
    await writer.append({channelId, event: makeEvent({seq: 1}), projectRoot, turnId})
    await writer.append({channelId, event: makeEvent({seq: 2}), projectRoot, turnId})

    const file = channelPaths.turnNdjsonFile(projectRoot, channelId, turnId)
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n')
    expect(lines).to.have.lengthOf(3)
    for (const line of lines) {
      expect(() => JSON.parse(line)).to.not.throw()
    }
  })

  it('rejects non-monotonic seq (writer enforces ordering)', async () => {
    await writer.append({channelId, event: makeEvent({seq: 0}), projectRoot, turnId})
    await writer.append({channelId, event: makeEvent({seq: 1}), projectRoot, turnId})

    let threw: unknown
    try {
      await writer.append({channelId, event: makeEvent({seq: 0}), projectRoot, turnId})
    } catch (error) {
      threw = error
    }

    expect(threw).to.be.an.instanceOf(Error)
    expect((threw as Error).message).to.match(/seq/i)
  })

  it('serialises concurrent appends to the same turn via the write lock', async () => {
    const N = 10
    const promises = Array.from({length: N}, (_, i) =>
      writer.append({channelId, event: makeEvent({seq: i}), projectRoot, turnId}),
    )
    await Promise.all(promises)

    const file = channelPaths.turnNdjsonFile(projectRoot, channelId, turnId)
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n')
    expect(lines).to.have.lengthOf(N)

    const seqs = lines.map((l) => (JSON.parse(l) as TurnEvent).seq)
    expect(seqs).to.deep.equal(Array.from({length: N}, (_, i) => i))
  })

  it('writes JSON without embedded newlines (one event per line)', async () => {
    const eventWithContent = makeEvent({
      content: 'line one\nline two', // newline inside the payload
      // these fields are dropped by zod-style narrowing but the writer must
      // not split the event across two physical lines.
      from: undefined as unknown as 'pending',
      kind: 'message',
      role: 'user',
      to: undefined as unknown as 'completed',
    } as Partial<TurnEvent>)

    await writer.append({channelId, event: eventWithContent, projectRoot, turnId})

    const file = channelPaths.turnNdjsonFile(projectRoot, channelId, turnId)
    const raw = await fs.readFile(file, 'utf8')
    // Exactly one trailing newline, no internal raw newline breaking the JSON.
    expect(raw.endsWith('\n')).to.equal(true)
    expect(raw.match(/\n/g)?.length).to.equal(1)
  })

  it('does not require a directory to exist beforehand', async () => {
    const fresh = '01HY-new'
    await writer.append({channelId, event: makeEvent({turnId: fresh}), projectRoot, turnId: fresh})
    // Slice 9.1: the parent dir for the per-turn NDJSON is the channel
    // history turns/ dir, created lazily by the writer.
    const stat = await fs.stat(channelPaths.historyTurnsDir(projectRoot, channelId))
    expect(stat.isDirectory()).to.equal(true)
  })
})
