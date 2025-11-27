import {expect} from 'chai'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../src/constants.js'
import {FileContextTreeSnapshotService} from '../../../../src/infra/context-tree/file-context-tree-snapshot-service.js'

describe('FileContextTreeSnapshotService', () => {
  let testDir: string
  let contextTreeDir: string
  let service: FileContextTreeSnapshotService

  beforeEach(async () => {
    testDir = join(tmpdir(), `brv-test-${Date.now()}`)
    contextTreeDir = join(testDir, BRV_DIR, CONTEXT_TREE_DIR)
    await mkdir(contextTreeDir, {recursive: true})
    service = new FileContextTreeSnapshotService({baseDirectory: testDir})
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
  })

  describe('constructor', () => {
    it('should use process.cwd() when no baseDirectory provided', async () => {
      const defaultService = new FileContextTreeSnapshotService()
      // Should not throw when calling methods (will use cwd)
      const hasSnapshot = await defaultService.hasSnapshot()
      expect(hasSnapshot).to.be.a('boolean')
    })

    it('should use provided baseDirectory', async () => {
      const customService = new FileContextTreeSnapshotService({baseDirectory: testDir})
      await customService.saveSnapshot()
      const hasSnapshot = await customService.hasSnapshot()
      expect(hasSnapshot).to.be.true
    })
  })

  describe('hasSnapshot', () => {
    it('should return false when no snapshot exists', async () => {
      const result = await service.hasSnapshot()
      expect(result).to.be.false
    })

    it('should return true when snapshot exists', async () => {
      await service.saveSnapshot()
      const result = await service.hasSnapshot()
      expect(result).to.be.true
    })

    it('should use directory parameter over baseDirectory', async () => {
      const otherDir = join(tmpdir(), `brv-other-${Date.now()}`)
      const otherContextDir = join(otherDir, BRV_DIR, CONTEXT_TREE_DIR)
      await mkdir(otherContextDir, {recursive: true})

      try {
        // Save snapshot in other directory
        await service.saveSnapshot(otherDir)

        // Check in base directory - should be false
        const hasInBase = await service.hasSnapshot()
        expect(hasInBase).to.be.false

        // Check in other directory - should be true
        const hasInOther = await service.hasSnapshot(otherDir)
        expect(hasInOther).to.be.true
      } finally {
        await rm(otherDir, {force: true, recursive: true})
      }
    })
  })

  describe('getCurrentState', () => {
    it('should return empty map for empty directory', async () => {
      const state = await service.getCurrentState()
      expect(state.size).to.equal(0)
    })

    it('should detect context.md files only', async () => {
      const domainDir = join(contextTreeDir, 'test_domain')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# Test')

      const state = await service.getCurrentState()
      expect(state.size).to.equal(1)
      expect(state.has('test_domain/context.md')).to.be.true
    })

    it('should ignore non-context.md files', async () => {
      const domainDir = join(contextTreeDir, 'test_domain')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'other.txt'), 'content')
      await writeFile(join(domainDir, 'readme.md'), '# Readme')
      await writeFile(join(domainDir, 'notes.md'), '# Notes')

      const state = await service.getCurrentState()
      expect(state.size).to.equal(0)
    })

    it('should track context.md in hidden directories', async () => {
      const hiddenDir = join(contextTreeDir, '.hidden')
      await mkdir(hiddenDir, {recursive: true})
      await writeFile(join(hiddenDir, 'context.md'), '# Hidden')

      const state = await service.getCurrentState()
      expect(state.size).to.equal(1)
      expect(state.has('.hidden/context.md')).to.be.true
    })

    it('should ignore hidden files that are not context.md', async () => {
      const domainDir = join(contextTreeDir, 'test_domain')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, '.hidden.md'), '# Hidden')

      const state = await service.getCurrentState()
      expect(state.size).to.equal(0)
    })

    it('should ignore snapshot file', async () => {
      await service.saveSnapshot()
      const state = await service.getCurrentState()
      expect(state.has('.snapshot.json')).to.be.false
    })

    it('should scan nested directories', async () => {
      const nestedDir = join(contextTreeDir, 'domain', 'topic', 'subtopic')
      await mkdir(nestedDir, {recursive: true})
      await writeFile(join(nestedDir, 'context.md'), '# Nested')

      const state = await service.getCurrentState()
      expect(state.size).to.equal(1)
      expect(state.has('domain/topic/subtopic/context.md')).to.be.true
    })

    it('should compute correct hash for file content', async () => {
      const domainDir = join(contextTreeDir, 'test')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# Test Content')

      const state = await service.getCurrentState()
      const fileState = state.get('test/context.md')

      expect(fileState).to.not.be.undefined
      expect(fileState!.hash).to.be.a('string')
      expect(fileState!.hash).to.have.lengthOf(64) // SHA-256 hex length
    })

    it('should compute correct size for file', async () => {
      const content = '# Test Content'
      const domainDir = join(contextTreeDir, 'test')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), content)

      const state = await service.getCurrentState()
      const fileState = state.get('test/context.md')

      expect(fileState).to.not.be.undefined
      expect(fileState!.size).to.equal(Buffer.byteLength(content))
    })

    it('should return different hashes for different content', async () => {
      const dir1 = join(contextTreeDir, 'dir1')
      const dir2 = join(contextTreeDir, 'dir2')
      await mkdir(dir1, {recursive: true})
      await mkdir(dir2, {recursive: true})
      await writeFile(join(dir1, 'context.md'), '# Content A')
      await writeFile(join(dir2, 'context.md'), '# Content B')

      const state = await service.getCurrentState()
      const hash1 = state.get('dir1/context.md')!.hash
      const hash2 = state.get('dir2/context.md')!.hash

      expect(hash1).to.not.equal(hash2)
    })

    it('should return same hash for same content', async () => {
      const dir1 = join(contextTreeDir, 'dir1')
      const dir2 = join(contextTreeDir, 'dir2')
      await mkdir(dir1, {recursive: true})
      await mkdir(dir2, {recursive: true})
      await writeFile(join(dir1, 'context.md'), '# Same Content')
      await writeFile(join(dir2, 'context.md'), '# Same Content')

      const state = await service.getCurrentState()
      const hash1 = state.get('dir1/context.md')!.hash
      const hash2 = state.get('dir2/context.md')!.hash

      expect(hash1).to.equal(hash2)
    })

    it('should return empty map when directory does not exist', async () => {
      const nonExistentService = new FileContextTreeSnapshotService({
        baseDirectory: '/non/existent/path',
      })

      const state = await nonExistentService.getCurrentState()
      expect(state.size).to.equal(0)
    })

    it('should only track context.md even when multiple files exist in same directory', async () => {
      const domainDir = join(contextTreeDir, 'design')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'overview.md'), '# Overview')
      await writeFile(join(domainDir, 'details.md'), '# Details')
      await writeFile(join(domainDir, 'context.md'), '# Context')

      const state = await service.getCurrentState()
      expect(state.size).to.equal(1)
      expect(state.has('design/overview.md')).to.be.false
      expect(state.has('design/details.md')).to.be.false
      expect(state.has('design/context.md')).to.be.true
    })

    it('should track context.md in multiple directories', async () => {
      const designDir = join(contextTreeDir, 'design')
      const codeDir = join(contextTreeDir, 'code')
      const testDir = join(contextTreeDir, 'testing')
      await mkdir(designDir, {recursive: true})
      await mkdir(codeDir, {recursive: true})
      await mkdir(testDir, {recursive: true})
      await writeFile(join(designDir, 'context.md'), '# Design')
      await writeFile(join(codeDir, 'context.md'), '# Code')
      await writeFile(join(testDir, 'context.md'), '# Testing')

      const state = await service.getCurrentState()
      expect(state.size).to.equal(3)
      expect(state.has('design/context.md')).to.be.true
      expect(state.has('code/context.md')).to.be.true
      expect(state.has('testing/context.md')).to.be.true
    })
  })

  describe('saveSnapshot and getChanges', () => {
    it('should detect no changes after saving snapshot', async () => {
      const domainDir = join(contextTreeDir, 'design')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# Design')

      await service.saveSnapshot()
      const changes = await service.getChanges()

      expect(changes.added).to.be.empty
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.be.empty
    })

    it('should detect added files', async () => {
      await service.saveSnapshot()

      const domainDir = join(contextTreeDir, 'new_domain')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# New')

      const changes = await service.getChanges()
      expect(changes.added).to.include('new_domain/context.md')
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.be.empty
    })

    it('should detect modified files', async () => {
      const domainDir = join(contextTreeDir, 'design')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# Original')

      await service.saveSnapshot()

      await writeFile(join(domainDir, 'context.md'), '# Modified content')

      const changes = await service.getChanges()
      expect(changes.added).to.be.empty
      expect(changes.modified).to.include('design/context.md')
      expect(changes.deleted).to.be.empty
    })

    it('should detect deleted files', async () => {
      const domainDir = join(contextTreeDir, 'design')
      await mkdir(domainDir, {recursive: true})
      const filePath = join(domainDir, 'context.md')
      await writeFile(filePath, '# Design')

      await service.saveSnapshot()

      await rm(filePath)

      const changes = await service.getChanges()
      expect(changes.added).to.be.empty
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.include('design/context.md')
    })

    it('should detect multiple types of changes', async () => {
      // Initial state
      const designDir = join(contextTreeDir, 'design')
      const codeDir = join(contextTreeDir, 'code_style')
      await mkdir(designDir, {recursive: true})
      await mkdir(codeDir, {recursive: true})
      await writeFile(join(designDir, 'context.md'), '# Design')
      await writeFile(join(codeDir, 'context.md'), '# Code')

      await service.saveSnapshot()

      // Make changes
      await writeFile(join(designDir, 'context.md'), '# Design Modified')
      await rm(join(codeDir, 'context.md'))
      const newDir = join(contextTreeDir, 'testing')
      await mkdir(newDir, {recursive: true})
      await writeFile(join(newDir, 'context.md'), '# Testing')

      const changes = await service.getChanges()
      expect(changes.modified).to.include('design/context.md')
      expect(changes.deleted).to.include('code_style/context.md')
      expect(changes.added).to.include('testing/context.md')
    })
  })

  describe('getChanges without snapshot', () => {
    it('should return empty changes when no snapshot exists', async () => {
      const domainDir = join(contextTreeDir, 'design')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# Design')

      const changes = await service.getChanges()
      expect(changes.added).to.be.empty
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.be.empty
    })
  })

  describe('initEmptySnapshot', () => {
    it('should create an empty snapshot file', async () => {
      await service.initEmptySnapshot()

      const hasSnapshot = await service.hasSnapshot()
      expect(hasSnapshot).to.be.true
    })

    it('should create snapshot with no files tracked', async () => {
      // Add some files first
      const domainDir = join(contextTreeDir, 'design')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# Design')

      // Init empty snapshot
      await service.initEmptySnapshot()

      // All files should appear as added
      const changes = await service.getChanges()
      expect(changes.added).to.include('design/context.md')
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.be.empty
    })

    it('should overwrite existing snapshot with empty one', async () => {
      // Create initial snapshot with files
      const domainDir = join(contextTreeDir, 'design')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# Design')
      await service.saveSnapshot()

      // Verify no changes initially
      let changes = await service.getChanges()
      expect(changes.added).to.be.empty

      // Init empty snapshot
      await service.initEmptySnapshot()

      // Now file should appear as added
      changes = await service.getChanges()
      expect(changes.added).to.include('design/context.md')
    })

    it('should write valid JSON to snapshot file', async () => {
      await service.initEmptySnapshot()

      const snapshotPath = join(contextTreeDir, '.snapshot.json')
      const content = await readFile(snapshotPath, 'utf8')
      const json = JSON.parse(content)

      expect(json.version).to.equal(1)
      expect(json.createdAt).to.be.a('string')
      expect(json.files).to.deep.equal({})
    })
  })

  describe('saveSnapshot', () => {
    it('should write valid JSON to snapshot file', async () => {
      const domainDir = join(contextTreeDir, 'design')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# Design')

      await service.saveSnapshot()

      const snapshotPath = join(contextTreeDir, '.snapshot.json')
      const content = await readFile(snapshotPath, 'utf8')
      const json = JSON.parse(content)

      expect(json.version).to.equal(1)
      expect(json.createdAt).to.be.a('string')
      expect(json.files['design/context.md']).to.exist
      expect(json.files['design/context.md'].hash).to.be.a('string')
      expect(json.files['design/context.md'].size).to.be.a('number')
    })

    it('should overwrite existing snapshot', async () => {
      const domainDir = join(contextTreeDir, 'design')
      await mkdir(domainDir, {recursive: true})
      await writeFile(join(domainDir, 'context.md'), '# Original')

      await service.saveSnapshot()

      // Modify file and save again
      await writeFile(join(domainDir, 'context.md'), '# Modified')
      await service.saveSnapshot()

      // Should have no changes after second save
      const changes = await service.getChanges()
      expect(changes.added).to.be.empty
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.be.empty
    })

    it('should use directory parameter', async () => {
      const otherDir = join(tmpdir(), `brv-other-${Date.now()}`)
      const otherContextDir = join(otherDir, BRV_DIR, CONTEXT_TREE_DIR)
      await mkdir(otherContextDir, {recursive: true})

      try {
        await service.saveSnapshot(otherDir)

        const snapshotPath = join(otherContextDir, '.snapshot.json')
        const content = await readFile(snapshotPath, 'utf8')
        const json = JSON.parse(content)

        expect(json.version).to.equal(1)
      } finally {
        await rm(otherDir, {force: true, recursive: true})
      }
    })
  })

  describe('getChanges', () => {
    it('should use directory parameter', async () => {
      const otherDir = join(tmpdir(), `brv-other-${Date.now()}`)
      const otherContextDir = join(otherDir, BRV_DIR, CONTEXT_TREE_DIR)
      await mkdir(otherContextDir, {recursive: true})

      try {
        // Save empty snapshot in other dir
        await service.initEmptySnapshot(otherDir)

        // Add file to other dir
        const domainDir = join(otherContextDir, 'design')
        await mkdir(domainDir, {recursive: true})
        await writeFile(join(domainDir, 'context.md'), '# Design')

        // Get changes from other dir
        const changes = await service.getChanges(otherDir)
        expect(changes.added).to.include('design/context.md')
      } finally {
        await rm(otherDir, {force: true, recursive: true})
      }
    })

    it('should handle corrupted snapshot file gracefully', async () => {
      const snapshotPath = join(contextTreeDir, '.snapshot.json')
      await writeFile(snapshotPath, 'not valid json')

      // Should return empty changes (like no snapshot)
      const changes = await service.getChanges()
      expect(changes.added).to.be.empty
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.be.empty
    })

    it('should handle snapshot with unsupported version', async () => {
      const snapshotPath = join(contextTreeDir, '.snapshot.json')
      await writeFile(snapshotPath, JSON.stringify({createdAt: new Date().toISOString(), files: {}, version: 999}))

      // Should return empty changes (like no snapshot)
      const changes = await service.getChanges()
      expect(changes.added).to.be.empty
      expect(changes.modified).to.be.empty
      expect(changes.deleted).to.be.empty
    })
  })
})
