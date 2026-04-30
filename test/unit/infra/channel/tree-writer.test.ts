import {expect} from 'chai'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {ChannelStorageParseError} from '../../../../src/server/core/domain/channel/errors.js'
import {artifactDir, channelDir, turnDir} from '../../../../src/server/infra/channel/storage/paths.js'
import {FileTreeReader} from '../../../../src/server/infra/channel/storage/tree-reader.js'
import {FileTreeWriter} from '../../../../src/server/infra/channel/storage/tree-writer.js'
import {channelMetaFixture, turnEventFixtures, turnFixture} from '../../../helpers/channel-fixtures.js'

describe('channel tree namespace I/O', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'brv-channel-tree-'))
  })

  afterEach(async () => {
    await rm(tempRoot, {force: true, recursive: true})
  })

  function meta() {
    return {...channelMetaFixture, treeRoot: tempRoot}
  }

  it('writes and reads channel meta through the canonical namespace', async () => {
    const writer = new FileTreeWriter()
    const reader = new FileTreeReader(tempRoot)
    const currentMeta = meta()

    await writer.writeMeta(currentMeta)

    const raw = JSON.parse(await readFile(path.join(channelDir(currentMeta), 'meta.json'), 'utf8'))
    expect(raw).to.deep.equal(currentMeta)
    expect(await reader.readMeta(currentMeta.channelId)).to.deep.equal(currentMeta)
  })

  it('writes a turn as turn.json, message.md, and events.jsonl', async () => {
    const writer = new FileTreeWriter()
    const reader = new FileTreeReader(tempRoot)
    const currentMeta = meta()
    const message = 'mock-a: hello'

    await writer.writeTurn(currentMeta, turnFixture, message, turnEventFixtures)

    const dir = turnDir(currentMeta, turnFixture.turnId)
    expect(JSON.parse(await readFile(path.join(dir, 'turn.json'), 'utf8'))).to.deep.equal(turnFixture)
    expect(await readFile(path.join(dir, 'message.md'), 'utf8')).to.equal(message)

    const eventLines = (await readFile(path.join(dir, 'events.jsonl'), 'utf8')).trim().split('\n')
    expect(eventLines.map((line) => JSON.parse(line))).to.deep.equal(turnEventFixtures)
    expect(await reader.readTurn(currentMeta, turnFixture.turnId)).to.deep.equal(turnFixture)
  })

  it('creates an initial turn placeholder before streaming events arrive', async () => {
    const writer = new FileTreeWriter()
    const currentMeta = meta()

    await writer.writeTurnInitial(currentMeta, turnFixture)

    const dir = turnDir(currentMeta, turnFixture.turnId)
    expect(JSON.parse(await readFile(path.join(dir, 'turn.json'), 'utf8'))).to.deep.equal(turnFixture)
    expect(await readFile(path.join(dir, 'message.md'), 'utf8')).to.equal('')
    expect(await readFile(path.join(dir, 'events.jsonl'), 'utf8')).to.equal('')
  })

  it('keeps concurrent writes to different turns isolated', async () => {
    const writer = new FileTreeWriter()
    const reader = new FileTreeReader(tempRoot)
    const currentMeta = meta()
    const firstTurn = {...turnFixture, turnId: 't-010'}
    const secondTurn = {...turnFixture, agentId: 'mock-b', promptText: 'second', turnId: 't-011'}

    await Promise.all([
      writer.writeTurn(currentMeta, firstTurn, 'first message', [turnEventFixtures[0]]),
      writer.writeTurn(currentMeta, secondTurn, 'second message', [turnEventFixtures[1]]),
    ])

    expect(await reader.readTurn(currentMeta, 't-010')).to.deep.equal(firstTurn)
    expect(await reader.readTurn(currentMeta, 't-011')).to.deep.equal(secondTurn)
    expect(await readFile(path.join(turnDir(currentMeta, 't-010'), 'message.md'), 'utf8')).to.equal('first message')
    expect(await readFile(path.join(turnDir(currentMeta, 't-011'), 'message.md'), 'utf8')).to.equal('second message')
  })

  it('reserves sequential turn IDs and persists the updated turn count', async () => {
    const writer = new FileTreeWriter()
    const reader = new FileTreeReader(tempRoot)
    const currentMeta = meta()
    await writer.writeMeta(currentMeta)

    const reserved = await writer.reserveTurnIds(currentMeta, 3)

    expect(reserved).to.deep.equal(['t-002', 't-003', 't-004'])
    expect(currentMeta.turnCount).to.equal(4)
    expect((await reader.readMeta(currentMeta.channelId))?.turnCount).to.equal(4)
  })

  it('appends artifacts under the channel artifact namespace', async () => {
    const writer = new FileTreeWriter()
    const currentMeta = meta()

    const result = await writer.appendArtifact(currentMeta, 'notes/plan.md', Buffer.from('hello'))
    await writer.appendArtifact(currentMeta, 'notes/plan.md', Buffer.from(' world'))

    expect(result).to.deep.equal({bytes: 5, path: 'notes/plan.md'})
    expect(await readFile(path.join(artifactDir(currentMeta), 'notes/plan.md'), 'utf8')).to.equal('hello world')
  })

  it('returns null for a missing channel and throws a typed error for malformed meta', async () => {
    const writer = new FileTreeWriter()
    const reader = new FileTreeReader(tempRoot)
    const currentMeta = meta()

    expect(await reader.readMeta('missing')).to.equal(null)

    await writer.ensureChannelDir(currentMeta)
    await writeFile(path.join(channelDir(currentMeta), 'meta.json'), '{"channelId": 42}', 'utf8')

    try {
      await reader.readMeta(currentMeta.channelId)
      expect.fail('expected readMeta to throw')
    } catch (error) {
      expect(error).to.be.instanceOf(ChannelStorageParseError)
      if (error instanceof ChannelStorageParseError) {
        expect(error.code).to.equal('CHANNEL_STORAGE_PARSE_ERROR')
        expect(error.path).to.equal(path.join(channelDir(currentMeta), 'meta.json'))
      }
    }
  })
})
