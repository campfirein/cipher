import {expect} from 'chai'

import {
  ContextTreeSnapshot,
  ContextTreeSnapshotJson,
  FileState,
} from '../../../../../src/core/domain/entities/context-tree-snapshot.js'

describe('ContextTreeSnapshot', () => {
  describe('create', () => {
    it('should create a snapshot with given files', () => {
      const files = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc123', size: 100}],
        ['testing/context.md', {hash: 'def456', size: 200}],
      ])

      const snapshot = ContextTreeSnapshot.create(files)

      expect(snapshot.version).to.equal(ContextTreeSnapshot.CURRENT_VERSION)
      expect(snapshot.files.size).to.equal(2)
      expect(snapshot.files.get('design/context.md')).to.deep.equal({hash: 'abc123', size: 100})
      expect(snapshot.createdAt).to.be.instanceOf(Date)
    })

    it('should create a snapshot with empty files', () => {
      const snapshot = ContextTreeSnapshot.create(new Map())

      expect(snapshot.version).to.equal(ContextTreeSnapshot.CURRENT_VERSION)
      expect(snapshot.files.size).to.equal(0)
    })

    it('should create defensive copy of files map', () => {
      const files = new Map<string, FileState>([['test.md', {hash: 'abc', size: 10}]])

      const snapshot = ContextTreeSnapshot.create(files)

      // Modify original map
      files.set('new.md', {hash: 'xyz', size: 20})

      // Snapshot should not be affected
      expect(snapshot.files.size).to.equal(1)
      expect(snapshot.files.has('new.md')).to.be.false
    })
  })

  describe('toJson', () => {
    it('should serialize snapshot to JSON', () => {
      const files = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc123', size: 100}],
      ])

      const snapshot = ContextTreeSnapshot.create(files)
      const json = snapshot.toJson()

      expect(json.version).to.equal(ContextTreeSnapshot.CURRENT_VERSION)
      expect(json.createdAt).to.be.a('string')
      expect(json.files).to.deep.equal({
        'design/context.md': {hash: 'abc123', size: 100},
      })
    })

    it('should produce valid ISO timestamp', () => {
      const snapshot = ContextTreeSnapshot.create(new Map())
      const json = snapshot.toJson()

      const parsedDate = new Date(json.createdAt)
      expect(parsedDate.toString()).to.not.equal('Invalid Date')
    })
  })

  describe('fromJson', () => {
    it('should deserialize valid JSON', () => {
      const json: ContextTreeSnapshotJson = {
        createdAt: '2024-01-15T10:30:00.000Z',
        files: {
          'design/context.md': {hash: 'abc123', size: 100},
          'testing/context.md': {hash: 'def456', size: 200},
        },
        version: 1,
      }

      const snapshot = ContextTreeSnapshot.fromJson(json)

      expect(snapshot).to.not.be.undefined
      expect(snapshot!.version).to.equal(1)
      expect(snapshot!.files.size).to.equal(2)
      expect(snapshot!.files.get('design/context.md')).to.deep.equal({hash: 'abc123', size: 100})
      expect(snapshot!.createdAt.toISOString()).to.equal('2024-01-15T10:30:00.000Z')
    })

    it('should return undefined for null input', () => {
      const snapshot = ContextTreeSnapshot.fromJson(null as unknown as ContextTreeSnapshotJson)
      expect(snapshot).to.be.undefined
    })

    it('should return undefined for undefined input', () => {
      const snapshot = ContextTreeSnapshot.fromJson(undefined as unknown as ContextTreeSnapshotJson)
      expect(snapshot).to.be.undefined
    })

    it('should return undefined for unsupported version', () => {
      const json: ContextTreeSnapshotJson = {
        createdAt: '2024-01-15T10:30:00.000Z',
        files: {},
        version: 999,
      }

      const snapshot = ContextTreeSnapshot.fromJson(json)
      expect(snapshot).to.be.undefined
    })

    it('should return undefined for missing createdAt', () => {
      const json = {
        files: {},
        version: 1,
      } as ContextTreeSnapshotJson

      const snapshot = ContextTreeSnapshot.fromJson(json)
      expect(snapshot).to.be.undefined
    })

    it('should return undefined for missing files', () => {
      const json = {
        createdAt: '2024-01-15T10:30:00.000Z',
        version: 1,
      } as ContextTreeSnapshotJson

      const snapshot = ContextTreeSnapshot.fromJson(json)
      expect(snapshot).to.be.undefined
    })

    it('should skip invalid file entries', () => {
      const json = {
        createdAt: '2024-01-15T10:30:00.000Z',
        files: {
          'invalid1.md': {hash: 123, size: 100}, // hash is not string
          'invalid2.md': {hash: 'abc', size: '100'}, // size is not number
          'invalid3.md': null, // null entry
          'valid.md': {hash: 'abc123', size: 100},
        },
        version: 1,
      } as unknown as ContextTreeSnapshotJson

      const snapshot = ContextTreeSnapshot.fromJson(json)

      expect(snapshot).to.not.be.undefined
      expect(snapshot!.files.size).to.equal(1)
      expect(snapshot!.files.has('valid.md')).to.be.true
    })
  })

  describe('compare', () => {
    it('should detect no changes when states are identical', () => {
      const files = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc123', size: 100}],
        ['testing/context.md', {hash: 'def456', size: 200}],
      ])

      const snapshot = ContextTreeSnapshot.create(files)
      const currentFiles = new Map(files)

      const changes = snapshot.compare(currentFiles)

      expect(changes.added).to.be.empty
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.be.empty
    })

    it('should detect added files', () => {
      const snapshotFiles = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc123', size: 100}],
      ])

      const snapshot = ContextTreeSnapshot.create(snapshotFiles)

      const currentFiles = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc123', size: 100}],
        ['new/context.md', {hash: 'ghi789', size: 300}],
        ['testing/context.md', {hash: 'def456', size: 200}],
      ])

      const changes = snapshot.compare(currentFiles)

      expect(changes.added).to.have.members(['testing/context.md', 'new/context.md'])
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.be.empty
    })

    it('should detect modified files', () => {
      const snapshotFiles = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc123', size: 100}],
        ['testing/context.md', {hash: 'def456', size: 200}],
      ])

      const snapshot = ContextTreeSnapshot.create(snapshotFiles)

      const currentFiles = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc123', size: 100}], // unchanged
        ['testing/context.md', {hash: 'changed', size: 250}], // modified
      ])

      const changes = snapshot.compare(currentFiles)

      expect(changes.added).to.be.empty
      expect(changes.modified).to.deep.equal(['testing/context.md'])
      expect(changes.deleted).to.be.empty
    })

    it('should detect deleted files', () => {
      const snapshotFiles = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc123', size: 100}],
        ['old/context.md', {hash: 'ghi789', size: 300}],
        ['testing/context.md', {hash: 'def456', size: 200}],
      ])

      const snapshot = ContextTreeSnapshot.create(snapshotFiles)

      const currentFiles = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc123', size: 100}],
      ])

      const changes = snapshot.compare(currentFiles)

      expect(changes.added).to.be.empty
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.have.members(['testing/context.md', 'old/context.md'])
    })

    it('should detect all change types simultaneously', () => {
      const snapshotFiles = new Map<string, FileState>([
        ['deleted/context.md', {hash: 'ccc', size: 300}],
        ['modified/context.md', {hash: 'bbb', size: 200}],
        ['unchanged/context.md', {hash: 'aaa', size: 100}],
      ])

      const snapshot = ContextTreeSnapshot.create(snapshotFiles)

      const currentFiles = new Map<string, FileState>([
        ['added/context.md', {hash: 'ddd', size: 400}],
        ['modified/context.md', {hash: 'modified-hash', size: 250}],
        ['unchanged/context.md', {hash: 'aaa', size: 100}],
      ])

      const changes = snapshot.compare(currentFiles)

      expect(changes.added).to.deep.equal(['added/context.md'])
      expect(changes.modified).to.deep.equal(['modified/context.md'])
      expect(changes.deleted).to.deep.equal(['deleted/context.md'])
    })

    it('should return sorted arrays', () => {
      const snapshotFiles = new Map<string, FileState>([
        ['a-file/context.md', {hash: 'bbb', size: 200}],
        ['z-file/context.md', {hash: 'aaa', size: 100}],
      ])

      const snapshot = ContextTreeSnapshot.create(snapshotFiles)

      const currentFiles = new Map<string, FileState>([
        ['a-new/context.md', {hash: 'ddd', size: 400}],
        ['z-new/context.md', {hash: 'ccc', size: 300}],
      ])

      const changes = snapshot.compare(currentFiles)

      expect(changes.added).to.deep.equal(['a-new/context.md', 'z-new/context.md'])
      expect(changes.deleted).to.deep.equal(['a-file/context.md', 'z-file/context.md'])
    })

    it('should handle empty snapshot comparing to files', () => {
      const snapshot = ContextTreeSnapshot.create(new Map())

      const currentFiles = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc', size: 100}],
        ['testing/context.md', {hash: 'def', size: 200}],
      ])

      const changes = snapshot.compare(currentFiles)

      expect(changes.added).to.have.members(['design/context.md', 'testing/context.md'])
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.be.empty
    })

    it('should handle files comparing to empty current state', () => {
      const snapshotFiles = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc', size: 100}],
        ['testing/context.md', {hash: 'def', size: 200}],
      ])

      const snapshot = ContextTreeSnapshot.create(snapshotFiles)
      const currentFiles = new Map<string, FileState>()

      const changes = snapshot.compare(currentFiles)

      expect(changes.added).to.be.empty
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.have.members(['design/context.md', 'testing/context.md'])
    })
  })

  describe('roundtrip', () => {
    it('should maintain data integrity through toJson/fromJson cycle', () => {
      const files = new Map<string, FileState>([
        ['design/context.md', {hash: 'abc123', size: 100}],
        ['testing/context.md', {hash: 'def456', size: 200}],
      ])

      const original = ContextTreeSnapshot.create(files)
      const json = original.toJson()
      const restored = ContextTreeSnapshot.fromJson(json)

      expect(restored).to.not.be.undefined
      expect(restored!.version).to.equal(original.version)
      expect(restored!.files.size).to.equal(original.files.size)

      for (const [path, state] of original.files) {
        expect(restored!.files.get(path)).to.deep.equal(state)
      }
    })
  })
})
