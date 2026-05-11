import {expect} from 'chai'
import {promises as fs} from 'node:fs'
import {dirname} from 'node:path'

import type {Turn} from '../../../../../../src/shared/types/channel.js'

import {channelPaths} from '../../../../../../src/server/infra/channel/storage/paths.js'
import {ChannelSnapshotWriter} from '../../../../../../src/server/infra/channel/storage/snapshot-writer.js'
import {makeTempContextTree} from '../../../../../helpers/temp-context-tree.js'
import {removeTempDir} from '../../../../../helpers/temp-dir.js'

// Slice 1.3 — one-shot finalisation snapshots per CHANNEL_PROTOCOL.md §4.2.
// turn.json / delivery snapshots / message bodies are written exactly once,
// via atomic rename, after a turn (or delivery) reaches terminal state.
// events.jsonl remains the source of truth.
describe('ChannelSnapshotWriter', () => {
  let projectRoot: string
  let writer: ChannelSnapshotWriter
  const channelId = 'pi-test'
  const turnId = '01HX'

  const sampleTurn = (): Turn => ({
    author: {handle: 'you', kind: 'local-user'},
    channelId,
    endedAt: '2026-05-11T00:00:01.000Z',
    mentions: [],
    promptBlocks: [{text: 'hi', type: 'text'}],
    promptedBy: 'user',
    startedAt: '2026-05-11T00:00:00.000Z',
    state: 'completed',
    turnId,
  })

  beforeEach(async () => {
    projectRoot = await makeTempContextTree()
    writer = new ChannelSnapshotWriter()
  })

  afterEach(async () => {
    await removeTempDir(projectRoot)
  })

  it('writes turn.json with the persisted Turn record', async () => {
    await writer.writeTurnSnapshot({channelId, projectRoot, turn: sampleTurn(), turnId})
    const file = channelPaths.turnSnapshotFile(projectRoot, channelId, turnId)
    const persisted = JSON.parse(await fs.readFile(file, 'utf8')) as Turn
    expect(persisted.turnId).to.equal(turnId)
    expect(persisted.state).to.equal('completed')
  })

  it('uses atomic rename — no .tmp file survives a successful write', async () => {
    await writer.writeTurnSnapshot({channelId, projectRoot, turn: sampleTurn(), turnId})
    const file = channelPaths.turnSnapshotFile(projectRoot, channelId, turnId)
    const turnDir = dirname(file)
    const entries = await fs.readdir(turnDir)
    expect(entries).to.include('turn.json')
    expect(entries.some((e) => e.endsWith('.tmp'))).to.equal(false)
  })

  it('creates the parent directory if it does not exist', async () => {
    const fresh = '01HY-new'
    await writer.writeTurnSnapshot({
      channelId,
      projectRoot,
      turn: {...sampleTurn(), turnId: fresh},
      turnId: fresh,
    })
    const file = channelPaths.turnSnapshotFile(projectRoot, channelId, fresh)
    expect((await fs.stat(file)).isFile()).to.equal(true)
  })

  it('writes a delivery snapshot at deliveries/<deliveryId>.json', async () => {
    const deliveryId = 'd-mock-1'
    const delivery = {
      artifactsTouched: [],
      channelId,
      deliveryId,
      endedAt: '2026-05-11T00:00:01.000Z',
      memberHandle: '@mock',
      startedAt: '2026-05-11T00:00:00.000Z',
      state: 'completed' as const,
      toolCallCount: 0,
      turnId,
    }
    await writer.writeDeliverySnapshot({channelId, delivery, deliveryId, projectRoot, turnId})

    const file = channelPaths.deliverySnapshotFile(projectRoot, channelId, turnId, deliveryId)
    const persisted = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(persisted.deliveryId).to.equal(deliveryId)
    expect(persisted.state).to.equal('completed')
  })

  it('writes a rendered message file at messages/<deliveryId>.md', async () => {
    const deliveryId = 'd-mock-1'
    await writer.writeMessage({
      body: '# Final reply\nHello from the mock agent.',
      channelId,
      deliveryId,
      projectRoot,
      turnId,
    })

    const file = channelPaths.messageFile(projectRoot, channelId, turnId, deliveryId)
    const persisted = await fs.readFile(file, 'utf8')
    expect(persisted).to.include('Hello from the mock agent.')
  })

  it('uses atomic rename for message files too', async () => {
    const deliveryId = 'd-mock-1'
    await writer.writeMessage({
      body: 'x',
      channelId,
      deliveryId,
      projectRoot,
      turnId,
    })
    const file = channelPaths.messageFile(projectRoot, channelId, turnId, deliveryId)
    const messagesDir = dirname(file)
    const entries = await fs.readdir(messagesDir)
    expect(entries.some((e) => e.endsWith('.tmp'))).to.equal(false)
  })
})
