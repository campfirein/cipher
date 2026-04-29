/**
 * Unit test for the `chunkLinesByBytes` helper that backs the size-bounded
 * tombstone batching in `FileTaskHistoryStore.tombstoneAndUnlink`.
 */

import {expect} from 'chai'

import {chunkLinesByBytes} from '../../../../src/server/infra/storage/file-task-history-store.js'

describe('chunkLinesByBytes', () => {
  it('returns a single chunk when total bytes fit under the cap', () => {
    const lines = ['{"a":1}\n', '{"b":2}\n']
    const chunks = chunkLinesByBytes(lines, 1024)
    expect(chunks.length).to.equal(1)
    expect(chunks[0]).to.deep.equal(lines)
  })

  it('splits at the byte boundary so each chunk stays under the cap', () => {
    // 4 lines × 10 bytes = 40 bytes total, cap of 25 → expect 2 chunks of 2 lines each.
    const line = '0123456789'
    const lines = [line, line, line, line]
    const chunks = chunkLinesByBytes(lines, 25)
    expect(chunks.length).to.equal(2)
    expect(chunks[0]).to.deep.equal([line, line])
    expect(chunks[1]).to.deep.equal([line, line])
  })

  it('emits an oversized line as its own chunk rather than splitting it', () => {
    const big = 'x'.repeat(50)
    const small = 'y'
    const chunks = chunkLinesByBytes([small, big, small], 10)
    expect(chunks.length).to.equal(3)
    expect(chunks[0]).to.deep.equal([small])
    expect(chunks[1]).to.deep.equal([big])
    expect(chunks[2]).to.deep.equal([small])
  })

  it('returns an empty array for an empty input', () => {
    expect(chunkLinesByBytes([], 1024)).to.deep.equal([])
  })

  it('keeps every chunk under the cap for 200 realistic tombstone lines', () => {
    const tombstone = JSON.stringify({_deleted: true, deletedAt: 1_745_432_000_000, schemaVersion: 1, taskId: 'a'.repeat(36)}) + '\n'
    const lines = Array.from({length: 200}, () => tombstone)
    const cap = 3584
    const chunks = chunkLinesByBytes(lines, cap)
    expect(chunks.length).to.be.greaterThan(1)
    for (const [i, chunk] of chunks.entries()) {
      const bytes = chunk.reduce((acc, l) => acc + Buffer.byteLength(l, 'utf8'), 0)
      expect(bytes, `chunk ${i} exceeds cap`).to.be.lessThanOrEqual(cap)
    }
  })
})
