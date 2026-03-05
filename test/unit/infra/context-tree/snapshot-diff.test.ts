import {expect} from 'chai'

import type {FileState} from '../../../../src/server/core/domain/entities/context-tree-snapshot.js'

import {diffStates} from '../../../../src/server/infra/context-tree/snapshot-diff.js'

function makeState(entries: Record<string, string>): Map<string, FileState> {
  const map = new Map<string, FileState>()
  for (const [path, hash] of Object.entries(entries)) {
    map.set(path, {hash, size: hash.length})
  }

  return map
}

describe('diffStates', () => {
  it('should return empty array when both states are empty', () => {
    const result = diffStates(new Map(), new Map())
    expect(result).to.deep.equal([])
  })

  it('should return empty array when states are identical', () => {
    const state = makeState({'domain/context.md': 'hash1', 'domain/topic.md': 'hash2'})
    const result = diffStates(state, state)
    expect(result).to.deep.equal([])
  })

  it('should detect added files', () => {
    const before = makeState({})
    const after = makeState({'domain/new-file.md': 'hash1'})
    const result = diffStates(before, after)
    expect(result).to.include('domain/new-file.md')
  })

  it('should detect modified files', () => {
    const before = makeState({'domain/context.md': 'old-hash'})
    const after = makeState({'domain/context.md': 'new-hash'})
    const result = diffStates(before, after)
    expect(result).to.include('domain/context.md')
  })

  it('should detect deleted files', () => {
    const before = makeState({'domain/deleted.md': 'hash1'})
    const after = makeState({})
    const result = diffStates(before, after)
    expect(result).to.include('domain/deleted.md')
  })

  it('should detect all three change types simultaneously', () => {
    const before = makeState({
      'domain/deleted.md': 'hash-del',
      'domain/modified.md': 'hash-old',
      'domain/unchanged.md': 'hash-same',
    })
    const after = makeState({
      'domain/added.md': 'hash-new',
      'domain/modified.md': 'hash-new',
      'domain/unchanged.md': 'hash-same',
    })
    const result = diffStates(before, after)
    expect(result).to.include('domain/added.md')
    expect(result).to.include('domain/modified.md')
    expect(result).to.include('domain/deleted.md')
    expect(result).to.not.include('domain/unchanged.md')
  })

  it('should exclude _index.md from results (derived artifact)', () => {
    const before = makeState({})
    const after = makeState({'domain/_index.md': 'hash1'})
    const result = diffStates(before, after)
    expect(result).to.not.include('domain/_index.md')
  })

  it('should exclude _manifest.json from results (derived artifact)', () => {
    const before = makeState({})
    const after = makeState({'_manifest.json': 'hash1'})
    const result = diffStates(before, after)
    expect(result).to.not.include('_manifest.json')
  })

  it('should exclude .stub.md in _archived/ from results', () => {
    const before = makeState({})
    const after = makeState({'_archived/auth/tokens.stub.md': 'hash1'})
    const result = diffStates(before, after)
    expect(result).to.not.include('_archived/auth/tokens.stub.md')
  })

  it('should exclude .full.md in _archived/ from results', () => {
    const before = makeState({})
    const after = makeState({'_archived/auth/tokens.full.md': 'hash1'})
    const result = diffStates(before, after)
    expect(result).to.not.include('_archived/auth/tokens.full.md')
  })

  it('should exclude derived artifacts from deletion detection', () => {
    const before = makeState({'domain/_index.md': 'hash1'})
    const after = makeState({})
    const result = diffStates(before, after)
    expect(result).to.not.include('domain/_index.md')
  })

  it('should handle large state maps', () => {
    const entries: Record<string, string> = {}
    for (let i = 0; i < 100; i++) {
      entries[`domain${i}/context.md`] = `hash${i}`
    }

    const before = makeState(entries)
    const afterEntries = {...entries}
    afterEntries['domain0/context.md'] = 'modified-hash'
    delete afterEntries['domain1/context.md']
    afterEntries['new-domain/context.md'] = 'new-hash'
    const after = makeState(afterEntries)

    const result = diffStates(before, after)
    expect(result).to.include('domain0/context.md')
    expect(result).to.include('domain1/context.md')
    expect(result).to.include('new-domain/context.md')
    expect(result).to.have.lengthOf(3)
  })
})
