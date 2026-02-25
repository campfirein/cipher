import {expect} from 'chai'
import {createHash} from 'node:crypto'
import {access, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR, CONTEXT_TREE_BACKUP_DIR, CONTEXT_TREE_CONFLICT_DIR, CONTEXT_TREE_DIR} from '../../../../src/server/constants.js'
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
      expect(result.conflicted).to.be.empty
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
      expect(result.conflicted).to.be.empty
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
      expect(result.conflicted).to.be.empty
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
      expect(result.conflicted).to.be.empty
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
      expect(result.conflicted).to.be.empty
    })
  })

  describe('merge — conflict: locally added file at same remote path', () => {
    it('should copy original to conflict dir, rename local to _1.md, write remote to original path', async () => {
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

      // Preserved local file is at the _1.md path
      const preserved = await readFile(join(contextTreeDir, 'topic_1.md'), 'utf8')
      expect(preserved).to.equal('# My local content')

      // topic_1.md (preserved local) is counted as added
      expect(result.added).to.include('topic_1.md')
      expect(result.edited).to.not.include('topic.md')

      // topic.md is reported as conflicted
      expect(result.conflicted).to.deep.equal(['topic.md'])

      // Conflict dir contains the original local content at the original path
      const expectedConflictDir = join(testDir, BRV_DIR, CONTEXT_TREE_CONFLICT_DIR)
      expect(result.conflictDir).to.equal(expectedConflictDir)
      const conflictCopy = await readFile(join(expectedConflictDir, 'topic.md'), 'utf8')
      expect(conflictCopy).to.equal('# My local content')
    })
  })

  describe('merge — conflict: locally modified file at same remote path', () => {
    it('should copy original to conflict dir, rename local to _1.md, write remote to original path', async () => {
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

      // docs.md is reported as conflicted
      expect(result.conflicted).to.deep.equal(['docs.md'])

      // Conflict dir contains the pre-conflict local version
      const expectedConflictDir = join(testDir, BRV_DIR, CONTEXT_TREE_CONFLICT_DIR)
      const conflictCopy = await readFile(join(expectedConflictDir, 'docs.md'), 'utf8')
      expect(conflictCopy).to.equal('# My modified content')
    })
  })

  describe('merge — conflict with converged content (both sides made the same change)', () => {
    it('should treat as edited (not conflict) when local and remote content are identical', async () => {
      await snapshotService.initEmptySnapshot()
      const sameContent = '# Same content on both sides'
      await writeFile(join(contextTreeDir, 'topic.md'), sameContent)

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('topic.md', sameContent)],
        localChanges: {added: ['topic.md'], deleted: [], modified: []},
      })

      // Original path still has the shared content
      const written = await readFile(join(contextTreeDir, 'topic.md'), 'utf8')
      expect(written).to.equal(sameContent)

      // No conflict — no _1.md file, no conflicted entry
      expect(result.conflicted).to.be.empty
      expect(result.edited).to.include('topic.md')
      expect(result.added).to.not.include('topic_1.md')
      expect(result.conflictDir).to.be.undefined

      // Conflict dir should not exist
      const conflictDirPath = join(testDir, BRV_DIR, CONTEXT_TREE_CONFLICT_DIR)
      try {
        await access(conflictDirPath)
        expect.fail('Conflict dir should not exist when content converged')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    })

    it('should treat as edited (not conflict) when locally modified file converges with remote', async () => {
      const originalContent = '# Original'
      const convergentContent = '# Same update by both sides'

      await writeFile(join(contextTreeDir, 'docs.md'), originalContent)
      await snapshotService.saveSnapshot()
      await writeFile(join(contextTreeDir, 'docs.md'), convergentContent)

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('docs.md', convergentContent)],
        localChanges: {added: [], deleted: [], modified: ['docs.md']},
      })

      const written = await readFile(join(contextTreeDir, 'docs.md'), 'utf8')
      expect(written).to.equal(convergentContent)

      expect(result.conflicted).to.be.empty
      expect(result.edited).to.include('docs.md')
      expect(result.conflictDir).to.be.undefined
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
      expect(result.conflicted).to.be.empty
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
      expect(result.conflicted).to.deep.equal(['topic.md'])
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
      expect(result.conflicted).to.be.empty
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
      expect(result.conflicted).to.be.empty
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
      expect(result.conflicted).to.be.empty
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
      expect(result.conflicted).to.be.empty
    })
  })

  describe('merge — subdirectory paths', () => {
    it('should copy original to conflict dir preserving directory structure', async () => {
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
      expect(result.conflicted).to.deep.equal(['arch/api/design.md'])

      // Conflict dir mirrors the subdirectory structure
      const conflictCopy = await readFile(join(testDir, BRV_DIR, CONTEXT_TREE_CONFLICT_DIR, 'arch/api/design.md'), 'utf8')
      expect(conflictCopy).to.equal('# Local design')
    })
  })

  describe('merge — backup and conflict folder behavior', () => {
    it('should delete backup and return no conflictDir when there are no conflicts', async () => {
      await snapshotService.initEmptySnapshot()
      await writeFile(join(contextTreeDir, 'existing.md'), '# Local content')

      const result = await merger.merge({
        directory: testDir,
        files: [makeFile('file.md', '# Remote')],
        localChanges: {added: [], deleted: [], modified: []},
      })

      expect(result.conflicted).to.be.empty
      expect(result.conflictDir).to.be.undefined

      // Backup must be deleted after a conflict-free merge
      const backupDir = join(testDir, BRV_DIR, CONTEXT_TREE_BACKUP_DIR)
      try {
        await access(backupDir)
        expect.fail('Backup should have been deleted after a conflict-free merge')
      } catch {
        // expected — backup was deleted
      }

      // Conflict dir must not exist
      const conflictDir = join(testDir, BRV_DIR, CONTEXT_TREE_CONFLICT_DIR)
      try {
        await access(conflictDir)
        expect.fail('Conflict dir should not exist when there are no conflicts')
      } catch {
        // expected
      }
    })

    it('should create conflict dir with only conflicted originals and delete backup on success', async () => {
      await snapshotService.initEmptySnapshot()
      await writeFile(join(contextTreeDir, 'conflict.md'), '# My local content')
      await writeFile(join(contextTreeDir, 'clean.md'), '# Clean content')

      const result = await merger.merge({
        directory: testDir,
        files: [
          makeFile('conflict.md', '# Remote content'),
          makeFile('clean.md', '# Clean content'), // same as local — no conflict
        ],
        localChanges: {added: ['conflict.md'], deleted: [], modified: []},
      })

      const expectedConflictDir = join(testDir, BRV_DIR, CONTEXT_TREE_CONFLICT_DIR)
      expect(result.conflicted).to.deep.equal(['conflict.md'])
      expect(result.conflictDir).to.equal(expectedConflictDir)

      // Conflict dir contains ONLY the conflicted file's original
      const conflictCopy = await readFile(join(expectedConflictDir, 'conflict.md'), 'utf8')
      expect(conflictCopy).to.equal('# My local content')

      // Clean file is NOT in conflict dir
      try {
        await access(join(expectedConflictDir, 'clean.md'))
        expect.fail('Non-conflicted file should not be in conflict dir')
      } catch {
        // expected
      }

      // Backup must be deleted after successful merge
      const backupDir = join(testDir, BRV_DIR, CONTEXT_TREE_BACKUP_DIR)
      try {
        await access(backupDir)
        expect.fail('Backup should have been deleted after successful merge')
      } catch {
        // expected
      }
    })

    it('should clear old conflict dir at start of next merge', async () => {
      // First merge — produces a conflict dir
      await snapshotService.initEmptySnapshot()
      await writeFile(join(contextTreeDir, 'topic.md'), '# My local content')

      await merger.merge({
        directory: testDir,
        files: [makeFile('topic.md', '# Remote content')],
        localChanges: {added: ['topic.md'], deleted: [], modified: []},
      })

      const conflictDir = join(testDir, BRV_DIR, CONTEXT_TREE_CONFLICT_DIR)
      await access(conflictDir) // confirm it exists after first merge

      // Second merge (no new conflicts) — conflict dir from first merge should be cleared
      await snapshotService.saveSnapshot()

      await merger.merge({
        directory: testDir,
        files: [makeFile('topic.md', '# Remote content')],
        localChanges: {added: [], deleted: [], modified: []},
      })

      try {
        await access(conflictDir)
        expect.fail('Old conflict dir should have been cleared at start of next merge')
      } catch {
        // expected — cleared
      }
    })

    it('should auto-restore context tree from backup when merge fails', async () => {
      await snapshotService.initEmptySnapshot()
      await writeFile(join(contextTreeDir, 'existing.md'), '# Local content')

      // Claim 'missing.md' is locally added, but it doesn't exist on disk.
      // runMerge() will throw ENOENT when trying to read it for conflict handling —
      // AFTER the backup has already been created.
      let thrownError: Error | undefined
      try {
        await merger.merge({
          directory: testDir,
          files: [makeFile('missing.md', '# Remote')],
          localChanges: {added: ['missing.md'], deleted: [], modified: []},
        })
        expect.fail('Should have thrown')
      } catch (error) {
        thrownError = error as Error
      }

      expect(thrownError!.message).to.include('restored to its original state')

      // Context tree should be restored to pre-merge state
      const restoredContent = await readFile(join(contextTreeDir, 'existing.md'), 'utf8')
      expect(restoredContent).to.equal('# Local content')

      // Backup must be gone (was used to restore, then deleted)
      const backupDir = join(testDir, BRV_DIR, CONTEXT_TREE_BACKUP_DIR)
      try {
        await access(backupDir)
        expect.fail('Backup should have been consumed during restore')
      } catch {
        // expected
      }

      // Conflict dir must not exist (cleaned up on failure)
      const conflictDir = join(testDir, BRV_DIR, CONTEXT_TREE_CONFLICT_DIR)
      try {
        await access(conflictDir)
        expect.fail('Conflict dir should have been cleaned up on failure')
      } catch {
        // expected
      }
    })
  })

  describe('merge — snapshot atomicity', () => {
    it('should save snapshot from remote states so preserved _N.md files appear as added on next getChanges()', async () => {
      // Set up: snapshot is empty, user has a local file
      await snapshotService.initEmptySnapshot()
      await writeFile(join(contextTreeDir, 'topic.md'), '# My local content')

      // Merge: remote also has topic.md → conflict → local saved as topic_1.md
      await merger.merge({
        directory: testDir,
        files: [makeFile('topic.md', '# Remote content')],
        localChanges: {added: ['topic.md'], deleted: [], modified: []},
      })

      // After merge the snapshot should only contain remote files (topic.md, not topic_1.md).
      // topic_1.md is on disk but absent from snapshot → getChanges() reports it as "added".
      const changes = await snapshotService.getChanges(testDir)
      expect(changes.added).to.include('topic_1.md')
      expect(changes.added).to.not.include('topic.md')
      expect(changes.modified).to.be.empty
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

      expect(result.conflicted).to.deep.equal(['conflict.md'])
    })
  })
})
