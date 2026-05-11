import {expect} from 'chai'
import {promises as fs} from 'node:fs'

import type {Turn, TurnEvent} from '../../../../../../src/shared/types/channel.js'

import {ChannelEventsWriter} from '../../../../../../src/server/infra/channel/storage/events-writer.js'
import {channelPaths} from '../../../../../../src/server/infra/channel/storage/paths.js'
import {ChannelSnapshotWriter} from '../../../../../../src/server/infra/channel/storage/snapshot-writer.js'
import {ChannelTreeReader} from '../../../../../../src/server/infra/channel/storage/tree-reader.js'
import {ChannelWriteSerializer} from '../../../../../../src/server/infra/channel/storage/write-serializer.js'
import {makeTempContextTree} from '../../../../../helpers/temp-context-tree.js'
import {removeTempDir} from '../../../../../helpers/temp-dir.js'

// Slice 1.3 — read side of the storage layer.
//
// Crash-recovery contract (Phase 1 DoD §2): when turn.json is missing or
// corrupt, the reader reconstructs the Turn by replaying events.jsonl. The
// snapshot is a derived cache; the events file is the source of truth.
describe('ChannelTreeReader', () => {
  let projectRoot: string
  let reader: ChannelTreeReader
  let eventsWriter: ChannelEventsWriter
  let snapshotWriter: ChannelSnapshotWriter
  const channelId = 'pi-test'
  const turnId = '01HX'

  beforeEach(async () => {
    projectRoot = await makeTempContextTree()
    reader = new ChannelTreeReader()
    eventsWriter = new ChannelEventsWriter({serializer: new ChannelWriteSerializer()})
    snapshotWriter = new ChannelSnapshotWriter()
  })

  afterEach(async () => {
    await removeTempDir(projectRoot)
  })

  const messageEvent = (seq: number, content: string): TurnEvent =>
    ({
      channelId,
      content,
      deliveryId: null,
      emittedAt: '2026-05-11T00:00:00.000Z',
      kind: 'message',
      memberHandle: null,
      role: 'user',
      seq,
      turnId,
    } as TurnEvent)

  const stateChangeEvent = (
    seq: number,
    from: Turn['state'],
    to: Turn['state'],
  ): TurnEvent =>
    ({
      channelId,
      deliveryId: null,
      emittedAt: '2026-05-11T00:00:01.000Z',
      from,
      kind: 'turn_state_change',
      memberHandle: null,
      seq,
      to,
      turnId,
    } as TurnEvent)

  const writeSampleTurn = async (): Promise<Turn> => {
    await eventsWriter.append({channelId, event: messageEvent(0, 'hi'), projectRoot, turnId})
    await eventsWriter.append({
      channelId,
      event: stateChangeEvent(1, 'pending', 'completed'),
      projectRoot,
      turnId,
    })

    const turn: Turn = {
      author: {handle: 'you', kind: 'local-user'},
      channelId,
      endedAt: '2026-05-11T00:00:01.000Z',
      mentions: [],
      promptBlocks: [{text: 'hi', type: 'text'}],
      promptedBy: 'user',
      startedAt: '2026-05-11T00:00:00.000Z',
      state: 'completed',
      turnId,
    }
    await snapshotWriter.writeTurnSnapshot({channelId, projectRoot, turn, turnId})
    return turn
  }

  describe('readEvents', () => {
    it('returns an empty array when events.jsonl does not exist', async () => {
      const events = await reader.readEvents({channelId, projectRoot, turnId})
      expect(events).to.deep.equal([])
    })

    it('returns events in seq order', async () => {
      await eventsWriter.append({channelId, event: messageEvent(0, 'a'), projectRoot, turnId})
      await eventsWriter.append({channelId, event: messageEvent(1, 'b'), projectRoot, turnId})
      await eventsWriter.append({channelId, event: messageEvent(2, 'c'), projectRoot, turnId})

      const events = await reader.readEvents({channelId, projectRoot, turnId})
      expect(events).to.have.lengthOf(3)
      expect(events.map((e) => (e.kind === 'message' ? e.content : ''))).to.deep.equal(['a', 'b', 'c'])
    })

    it('skips blank lines tolerantly (events.jsonl may have a trailing newline)', async () => {
      await eventsWriter.append({channelId, event: messageEvent(0, 'a'), projectRoot, turnId})
      const file = channelPaths.eventsFile(projectRoot, channelId, turnId)
      // Add a couple of extra blank lines.
      await fs.appendFile(file, '\n\n')

      const events = await reader.readEvents({channelId, projectRoot, turnId})
      expect(events).to.have.lengthOf(1)
    })
  })

  describe('readTurn (snapshot present)', () => {
    it('returns the snapshot directly when turn.json exists', async () => {
      const written = await writeSampleTurn()
      const turn = await reader.readTurn({channelId, projectRoot, turnId})
      expect(turn).to.exist
      expect(turn!.turnId).to.equal(written.turnId)
      expect(turn!.state).to.equal('completed')
    })

    it('returns undefined when neither snapshot nor events exist', async () => {
      const turn = await reader.readTurn({channelId, projectRoot, turnId: '01HY-missing'})
      expect(turn).to.be.undefined
    })
  })

  describe('readTurn (snapshot missing — replay fallback)', () => {
    it('reconstructs the Turn from events.jsonl when turn.json is missing', async () => {
      await writeSampleTurn()

      // Simulate a crash that drops the snapshot but keeps events.jsonl.
      const snapshotFile = channelPaths.turnSnapshotFile(projectRoot, channelId, turnId)
      await fs.rm(snapshotFile)

      const turn = await reader.readTurn({channelId, projectRoot, turnId})
      expect(turn, 'turn must be reconstructed from events').to.exist
      expect(turn!.turnId).to.equal(turnId)
      // The final state came from the last turn_state_change event.
      expect(turn!.state).to.equal('completed')
    })

    it('reconstructs when turn.json is corrupt (invalid JSON)', async () => {
      await writeSampleTurn()
      const snapshotFile = channelPaths.turnSnapshotFile(projectRoot, channelId, turnId)
      await fs.writeFile(snapshotFile, '{ this is not valid json')

      const turn = await reader.readTurn({channelId, projectRoot, turnId})
      expect(turn).to.exist
      expect(turn!.state).to.equal('completed')
    })

    it('returns undefined when events.jsonl is also missing', async () => {
      // No-op setup: no writer calls. Both files absent.
      const turn = await reader.readTurn({channelId, projectRoot, turnId: '01HY-empty'})
      expect(turn).to.be.undefined
    })
  })
})
