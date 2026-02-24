import {expect} from 'chai'
import {createHash} from 'node:crypto'
import {access, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR, CONTEXT_TREE_BACKUP_DIR, CONTEXT_TREE_DIR} from '../../../../src/server/constants.js'
import {CogitSnapshotFile} from '../../../../src/server/core/domain/entities/cogit-snapshot-file.js'
import {FileContextTreeMerger} from '../../../../src/server/infra/context-tree/file-context-tree-merger.js'
import {FileContextTreeSnapshotService} from '../../../../src/server/infra/context-tree/file-context-tree-snapshot-service.js'

// Helper: encode content to base64 for CogitSnapshotFile
function toBase64(content: string): string {
  return Buffer.from(content, 'utf8').toString('base64')
}

// Helper: build a CogitSnapshotFile
function makeFile(path: string, content: string): CogitSnapshotFile {
  return new CogitSnapshotFile({
    content: toBase64(content),
    mode: '100644',
    path,
    sha: 'deadbeef',
    size: Buffer.byteLength(content, 'utf8'),
  })
}

// Helper: compute SHA-256 of a string (matches FileContextTreeSnapshotService)
function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

describe('FileContextTreeMerger', () => {
  let testDir: string
  let contextTreeDir: string
  let snapshotService: FileContextTreeSnapshotService
  let merger: FileContextTreeMerger

  beforeEach(async () => {
    testDir = join(tmpdir(), `brv-merger-test-${Date.now()}`)
    contextTreeDir = join(testDir, BRV_DIR, CONTEXT_TREE_DIR)
    await mkdir(contextTreeDir, {recursive: true})

    snapshotService = new FileContextTreeSnapshotService({baseDirectory: testDir})
    merger = new FileContextTreeMerger({snapshotService})
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('merge — remote file added (no local file)', () => {
    it('should write the remote file to context tree', async () => {
      await snapshotService.initEmptySnapshot()

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('topic/concept.md', '# Concept\nContent here')],
        localChanges: {added: [], deleted: [], modified: []},
      })

      const written = await readFile(join(contextTreeDir, 'topic/concept.md'), 'utf8')
      expect(written).to.equal('# Concept\nContent here')
      expect(result.added).to.deep.equal(['topic/concept.md'])
      expect(result.edited).to.be.empty
      expect(result.deleted).to.be.empty
    })

    it('should include remote file in remoteFileStates with correct hash', async () => {
      await snapshotService.initEmptySnapshot()
      const content = '# Concept\nContent here'

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('topic/concept.md', content)],
        localChanges: {added: [], deleted: [], modified: []},
      })

      const state = result.remoteFileStates.get('topic/concept.md')
      expect(state).to.exist
      expect(state!.hash).to.equal(sha256(content))
      expect(state!.size).to.equal(Buffer.byteLength(content, 'utf8'))
    })
  })

  describe('merge — remote file overwrites clean local file', () => {
    it('should overwrite clean local file when remote has newer content', async () => {
      // Write a clean local file and snapshot it
      await writeFile(join(contextTreeDir, 'topic.md'), '# Old content')
      await snapshotService.saveSnapshot()

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('topic.md', '# New remote content')],
        localChanges: {added: [], deleted: [], modified: []},
      })

      const written = await readFile(join(contextTreeDir, 'topic.md'), 'utf8')
      expect(written).to.equal('# New remote content')
      expect(result.edited).to.deep.equal(['topic.md'])
    })

    it('should skip when remote content matches snapshot (remote unchanged)', async () => {
      const content = '# Same content'
      await writeFile(join(contextTreeDir, 'topic.md'), content)
      await snapshotService.saveSnapshot()

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('topic.md', content)],
        localChanges: {added: [], deleted: [], modified: []},
      })

      expect(result.edited).to.be.empty
      expect(result.added).to.be.empty
    })
  })

  describe('merge — local wins when remote has not changed', () => {
    it('should keep locally modified file when remote content matches snapshot', async () => {
      // User modified docs.md but remote still has the original version
      await writeFile(join(contextTreeDir, 'docs.md'), '# Original content')
      await snapshotService.saveSnapshot()
      await writeFile(join(contextTreeDir, 'docs.md'), '# My modified content')

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('docs.md', '# Original content')], // remote = snapshot
        localChanges: {added: [], deleted: [], modified: ['docs.md']},
      })

      // Local modification must be preserved — no rename, no overwrite
      const onDisk = await readFile(join(contextTreeDir, 'docs.md'), 'utf8')
      expect(onDisk).to.equal('# My modified content')
      expect(result.edited).to.be.empty
    })

    it('should keep locally deleted file absent when remote content matches snapshot', async () => {
      const content = '# Soon to be gone'
      await writeFile(join(contextTreeDir, 'deleted.md'), content)
      await snapshotService.saveSnapshot()
      const {unlink} = await import('node:fs/promises')
      await unlink(join(contextTreeDir, 'deleted.md'))

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('deleted.md', content)], // remote = snapshot (no change)
        localChanges: {added: [], deleted: ['deleted.md'], modified: []},
      })

      // Local deletion wins — file must stay absent
      try {
        await access(join(contextTreeDir, 'deleted.md'))
        expect.fail('File should not exist')
      } catch {
        // expected
      }

      // File is tracked in remoteFileStates so next getChanges() reports it as deleted
      expect(result.remoteFileStates.has('deleted.md')).to.be.true
      expect(result.added).to.not.include('deleted.md')
    })
  })

  describe('merge — conflict: locally added file at same remote path', () => {
    it('should rename local added file to _1.md and write remote to original path', async () => {
      // Snapshot is empty but user added a file (not in snapshot = "added")
      await snapshotService.initEmptySnapshot()
      await writeFile(join(contextTreeDir, 'topic.md'), '# My local content')

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('topic.md', '# Remote content')],
        localChanges: {added: ['topic.md'], deleted: [], modified: []},
      })

      // Original path has remote content
      const original = await readFile(join(contextTreeDir, 'topic.md'), 'utf8')
      expect(original).to.equal('# Remote content')

      // Preserved local file is at the new path
      const preserved = await readFile(join(contextTreeDir, 'topic_1.md'), 'utf8')
      expect(preserved).to.equal('# My local content')

      // topic_1.md (preserved local) is counted as added
      expect(result.added).to.include('topic_1.md')
      expect(result.edited).to.not.include('topic.md')
    })
  })

  describe('merge — conflict: locally modified file at same remote path', () => {
    it('should rename locally modified file to _1.md and write remote to original path', async () => {
      // Write original content, snapshot it, then modify locally and have remote also update
      await writeFile(join(contextTreeDir, 'docs.md'), '# Original content')
      await snapshotService.saveSnapshot()
      await writeFile(join(contextTreeDir, 'docs.md'), '# My modified content')

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('docs.md', '# Remote updated content')], // remote changed too
        localChanges: {added: [], deleted: [], modified: ['docs.md']},
      })

      const original = await readFile(join(contextTreeDir, 'docs.md'), 'utf8')
      expect(original).to.equal('# Remote updated content')

      const preserved = await readFile(join(contextTreeDir, 'docs_1.md'), 'utf8')
      expect(preserved).to.equal('# My modified content')

      // docs_1.md (preserved local) is counted as added
      expect(result.added).to.include('docs_1.md')
      expect(result.edited).to.not.include('docs.md')
    })
  })

  describe('merge — locally deleted file with remote having newer version', () => {
    it('should restore file from remote when remote has newer content than snapshot', async () => {
      // File was tracked in snapshot but now deleted locally
      await writeFile(join(contextTreeDir, 'deleted.md'), '# Original content')
      await snapshotService.saveSnapshot()
      const {unlink} = await import('node:fs/promises')
      await unlink(join(contextTreeDir, 'deleted.md'))

      // Remote has a NEWER version (different from snapshot)
      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('deleted.md', '# Newer remote version')],
        localChanges: {added: [], deleted: ['deleted.md'], modified: []},
      })

      // File should be restored from remote
      const restored = await readFile(join(contextTreeDir, 'deleted.md'), 'utf8')
      expect(restored).to.equal('# Newer remote version')
      expect(result.added).to.include('deleted.md')
    })
  })

  describe('merge — suffix collision', () => {
    it('should use _2.md when _1.md already exists', async () => {
      await snapshotService.initEmptySnapshot()
      // Both topic.md and topic_1.md exist as "added" local files
      await writeFile(join(contextTreeDir, 'topic.md'), '# Local topic')
      await writeFile(join(contextTreeDir, 'topic_1.md'), '# Already taken suffix')

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('topic.md', '# Remote topic')],
        localChanges: {added: ['topic.md'], deleted: [], modified: []},
      })

      const preserved = await readFile(join(contextTreeDir, 'topic_2.md'), 'utf8')
      expect(preserved).to.equal('# Local topic')
      expect(result.added).to.include('topic_2.md')
    })
  })

  describe('merge — clean local file not in remote (remote deleted it)', () => {
    it('should delete clean local files that remote does not have', async () => {
      // Create and snapshot two files
      await writeFile(join(contextTreeDir, 'keep.md'), '# Keep this')
      await writeFile(join(contextTreeDir, 'remove.md'), '# Remote deleted this')
      await snapshotService.saveSnapshot()

      // Remote only has 'keep.md' with same content — 'remove.md' was deleted from remote
      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('keep.md', '# Keep this')],
        localChanges: {added: [], deleted: [], modified: []},
      })

      // remove.md should be gone
      try {
        await access(join(contextTreeDir, 'remove.md'))
        expect.fail('File should have been deleted')
      } catch {
        // expected
      }

      expect(result.deleted).to.include('remove.md')
    })

    it('should NOT delete locally added files even if not in remote', async () => {
      // User added 'local-only.md' (not in snapshot = "added")
      await snapshotService.initEmptySnapshot()
      await writeFile(join(contextTreeDir, 'local-only.md'), '# My local work')

      // Remote has nothing
      const result = await merger.merge({
        directory: testDir,
        files: [],
        localChanges: {added: ['local-only.md'], deleted: [], modified: []},
      })

      // local-only.md should still exist
      const content = await readFile(join(contextTreeDir, 'local-only.md'), 'utf8')
      expect(content).to.equal('# My local work')
      expect(result.deleted).to.not.include('local-only.md')
    })

    it('should NOT delete locally modified files even if not in remote (remote deleted them)', async () => {
      // File was in snapshot, user modified it, but remote deleted it
      await writeFile(join(contextTreeDir, 'notes.md'), '# Original')
      await snapshotService.saveSnapshot()
      await writeFile(join(contextTreeDir, 'notes.md'), '# My modifications')

      // Remote has nothing (it deleted the file)
      const result = await merger.merge({
        directory: testDir,
        files: [],
        localChanges: {added: [], deleted: [], modified: ['notes.md']},
      })

      // Local modification wins — file stays
      const content = await readFile(join(contextTreeDir, 'notes.md'), 'utf8')
      expect(content).to.equal('# My modifications')
      expect(result.deleted).to.not.include('notes.md')
    })
  })

  describe('merge — locally deleted file not in remote', () => {
    it('should leave file absent when local deleted and remote also does not have it', async () => {
      // File was in snapshot but deleted locally; remote also dropped it
      await writeFile(join(contextTreeDir, 'gone.md'), '# Removed by both')
      await snapshotService.saveSnapshot()
      const {unlink} = await import('node:fs/promises')
      await unlink(join(contextTreeDir, 'gone.md'))

      // No error, no restore
      const result = await merger.merge({
        directory: testDir,
        files: [], // remote does not have it either
        localChanges: {added: [], deleted: ['gone.md'], modified: []},
      })

      try {
        await access(join(contextTreeDir, 'gone.md'))
        expect.fail('File should remain absent')
      } catch {
        // expected
      }

      expect(result.added).to.not.include('gone.md')
      expect(result.edited).to.not.include('gone.md')
      expect(result.deleted).to.not.include('gone.md') // deletion loop only iterates localState (disk), file is not there
    })
  })

  describe('merge — subdirectory paths', () => {
    it('should rename conflicting files preserving directory structure', async () => {
      await snapshotService.initEmptySnapshot()
      await mkdir(join(contextTreeDir, 'arch/api'), {recursive: true})
      await writeFile(join(contextTreeDir, 'arch/api/design.md'), '# Local design')

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('arch/api/design.md', '# Remote design')],
        localChanges: {added: ['arch/api/design.md'], deleted: [], modified: []},
      })

      const original = await readFile(join(contextTreeDir, 'arch/api/design.md'), 'utf8')
      expect(original).to.equal('# Remote design')

      const preserved = await readFile(join(contextTreeDir, 'arch/api/design_1.md'), 'utf8')
      expect(preserved).to.equal('# Local design')

      expect(result.added).to.include('arch/api/design_1.md')
    })
  })

  describe('merge — backup safety', () => {
    it('should return backupDir and leave backup for caller to delete after successful merge', async () => {
      await snapshotService.initEmptySnapshot()
      await writeFile(join(contextTreeDir, 'existing.md'), '# Local content')

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('file.md', '# Remote')],
        localChanges: {added: [], deleted: [], modified: []},
      })

      const expectedBackupDir = join(testDir, BRV_DIR, CONTEXT_TREE_BACKUP_DIR)
      expect(result.backupDir).to.equal(expectedBackupDir)

      // Backup must still exist — caller (space-handler) deletes it after saveSnapshotFromState succeeds
      await access(expectedBackupDir) // throws if not found → test fails
      const backupContent = await readFile(join(expectedBackupDir, 'existing.md'), 'utf8')
      expect(backupContent).to.equal('# Local content')
    })

    it('should preserve backup when merge fails mid-operation', async () => {
      await snapshotService.initEmptySnapshot()
      await writeFile(join(contextTreeDir, 'existing.md'), '# Local content')

      // Claim 'missing.md' is locally added, but it doesn't exist on disk.
      // runMerge() will throw ENOENT when trying to read it for conflict handling —
      // AFTER the backup has already been created.
      try {
        await merger.merge({
          directory: testDir,
          files: [makeFile('missing.md', '# Remote')],
          localChanges: {added: ['missing.md'], deleted: [], modified: []},
        })
        expect.fail('Should have thrown')
      } catch {
        // expected
      }

      // Backup should still exist for manual recovery
      const backupDir = join(testDir, BRV_DIR, CONTEXT_TREE_BACKUP_DIR)
      await access(backupDir) // throws if not found → test fails
      const backupContent = await readFile(join(backupDir, 'existing.md'), 'utf8')
      expect(backupContent).to.equal('# Local content')
    })
  })

  describe('merge — remoteFileStates', () => {
    it('should contain only remote files, not locally preserved files', async () => {
      await snapshotService.initEmptySnapshot()
      await writeFile(join(contextTreeDir, 'conflict.md'), '# Local')

      const result = await merger.merge({
        directory: testDir,
        files: [
          makeFile('conflict.md', '# Remote conflict'),
          makeFile('new-file.md', '# Remote new'),
        ],
        localChanges: {added: ['conflict.md'], deleted: [], modified: []},
      })

      // remoteFileStates contains the 2 remote file paths
      expect(result.remoteFileStates.size).to.equal(2)
      expect(result.remoteFileStates.has('conflict.md')).to.be.true
      expect(result.remoteFileStates.has('new-file.md')).to.be.true

      // conflict_1.md (preserved local) is in added, NOT in remoteFileStates
      expect(result.added).to.include('conflict_1.md')
      expect(result.remoteFileStates.has('conflict_1.md')).to.be.false
    })
  })
})
