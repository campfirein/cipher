import {expect} from 'chai'

import {computeChildrenHash} from '../../../../src/server/infra/context-tree/children-hash.js'

describe('computeChildrenHash', () => {
  it('should return a 64-character hex string (SHA-256)', () => {
    const hash = computeChildrenHash([{contentHash: 'abc123', path: 'file.md'}])
    expect(hash).to.be.a('string')
    expect(hash).to.have.lengthOf(64)
  })

  it('should be deterministic for the same input', () => {
    const children = [
      {contentHash: 'hash1', path: 'a.md'},
      {contentHash: 'hash2', path: 'b.md'},
    ]
    const hash1 = computeChildrenHash(children)
    const hash2 = computeChildrenHash(children)
    expect(hash1).to.equal(hash2)
  })

  it('should produce the same hash regardless of input order', () => {
    const hash1 = computeChildrenHash([
      {contentHash: 'hash1', path: 'a.md'},
      {contentHash: 'hash2', path: 'b.md'},
    ])
    const hash2 = computeChildrenHash([
      {contentHash: 'hash2', path: 'b.md'},
      {contentHash: 'hash1', path: 'a.md'},
    ])
    expect(hash1).to.equal(hash2)
  })

  it('should detect content changes (same paths, different hashes)', () => {
    const before = computeChildrenHash([{contentHash: 'old', path: 'file.md'}])
    const after = computeChildrenHash([{contentHash: 'new', path: 'file.md'}])
    expect(before).to.not.equal(after)
  })

  it('should detect renames (different paths, same content hash)', () => {
    const before = computeChildrenHash([{contentHash: 'hash1', path: 'old-name.md'}])
    const after = computeChildrenHash([{contentHash: 'hash1', path: 'new-name.md'}])
    expect(before).to.not.equal(after)
  })

  it('should detect additions', () => {
    const before = computeChildrenHash([{contentHash: 'hash1', path: 'a.md'}])
    const after = computeChildrenHash([
      {contentHash: 'hash1', path: 'a.md'},
      {contentHash: 'hash2', path: 'b.md'},
    ])
    expect(before).to.not.equal(after)
  })

  it('should detect deletions', () => {
    const before = computeChildrenHash([
      {contentHash: 'hash1', path: 'a.md'},
      {contentHash: 'hash2', path: 'b.md'},
    ])
    const after = computeChildrenHash([{contentHash: 'hash1', path: 'a.md'}])
    expect(before).to.not.equal(after)
  })

  it('should handle empty array', () => {
    const hash = computeChildrenHash([])
    expect(hash).to.be.a('string')
    expect(hash).to.have.lengthOf(64)
  })

  it('should handle single child', () => {
    const hash = computeChildrenHash([{contentHash: 'abc', path: 'only.md'}])
    expect(hash).to.be.a('string')
    expect(hash).to.have.lengthOf(64)
  })

  it('should not mutate the original array', () => {
    const children = [
      {contentHash: 'hash2', path: 'b.md'},
      {contentHash: 'hash1', path: 'a.md'},
    ]
    computeChildrenHash(children)
    expect(children[0].path).to.equal('b.md')
    expect(children[1].path).to.equal('a.md')
  })
})
