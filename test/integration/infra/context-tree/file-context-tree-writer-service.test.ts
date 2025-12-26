import {expect} from 'chai'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import * as sinon from 'sinon'

import type {FileState} from '../../../../src/core/domain/entities/context-tree-snapshot.js'
import type {IContextTreeSnapshotService} from '../../../../src/core/interfaces/i-context-tree-snapshot-service.js'

import {BRV_DIR, CONTEXT_TREE_DIR} from '../../../../src/constants.js'
import {CogitSnapshotFile} from '../../../../src/core/domain/entities/cogit-snapshot-file.js'
import {FileContextTreeWriterService} from '../../../../src/infra/context-tree/file-context-tree-writer-service.js'

const createFile = (path: string, content: string): CogitSnapshotFile =>
  new CogitSnapshotFile({
    content: Buffer.from(content).toString('base64'),
    mode: '100644',
    path,
    sha: 'abc123',
    size: content.length,
  })

describe('FileContextTreeWriterService', () => {
  let testDir: string
  let contextTreeDir: string
  let mockSnapshotService: sinon.SinonStubbedInstance<IContextTreeSnapshotService>
  let service: FileContextTreeWriterService

  beforeEach(async () => {
    testDir = join(tmpdir(), `brv-writer-test-${Date.now()}`)
    contextTreeDir = join(testDir, BRV_DIR, CONTEXT_TREE_DIR)
    await mkdir(contextTreeDir, {recursive: true})

    mockSnapshotService = {
      getChanges: sinon.stub(),
      getCurrentState: sinon.stub(),
      hasSnapshot: sinon.stub(),
      initEmptySnapshot: sinon.stub(),
      saveSnapshot: sinon.stub(),
    }
    mockSnapshotService.getCurrentState.resolves(new Map())

    service = new FileContextTreeWriterService({snapshotService: mockSnapshotService}, {baseDirectory: testDir})
  })

  afterEach(async () => {
    await rm(testDir, {force: true, recursive: true})
    sinon.restore()
  })

  describe('constructor', () => {
    it('should create service with dependencies and config', () => {
      expect(service).to.be.instanceOf(FileContextTreeWriterService)
    })

    it('should create service with default config', () => {
      const defaultService = new FileContextTreeWriterService({snapshotService: mockSnapshotService})
      expect(defaultService).to.be.instanceOf(FileContextTreeWriterService)
    })
  })

  describe('sync()', () => {
    describe('adding files', () => {
      it('should add new file when not present locally', async () => {
        const files = [createFile('design/context.md', '# Design Guide')]

        const result = await service.sync({files})

        expect(result.added).to.deep.equal(['design/context.md'])
        expect(result.edited).to.be.empty
        expect(result.deleted).to.be.empty

        const content = await readFile(join(contextTreeDir, 'design/context.md'), 'utf8')
        expect(content).to.equal('# Design Guide')
      })

      it('should add multiple new files', async () => {
        const files = [
          createFile('design/context.md', '# Design'),
          createFile('code_style/context.md', '# Code Style'),
          createFile('testing/context.md', '# Testing'),
        ]

        const result = await service.sync({files})

        expect(result.added).to.have.lengthOf(3)
        expect(result.added).to.include('design/context.md')
        expect(result.added).to.include('code_style/context.md')
        expect(result.added).to.include('testing/context.md')
      })

      it('should create nested directories as needed', async () => {
        const files = [createFile('domain/topic/subtopic/context.md', '# Deep nested')]

        const result = await service.sync({files})

        expect(result.added).to.deep.equal(['domain/topic/subtopic/context.md'])

        const content = await readFile(join(contextTreeDir, 'domain/topic/subtopic/context.md'), 'utf8')
        expect(content).to.equal('# Deep nested')
      })

      it('should normalize paths by removing leading slashes', async () => {
        const files = [createFile('/design/context.md', '# Design')]

        const result = await service.sync({files})

        expect(result.added).to.deep.equal(['design/context.md'])

        const content = await readFile(join(contextTreeDir, 'design/context.md'), 'utf8')
        expect(content).to.equal('# Design')
      })

      it('should remove multiple leading slashes', async () => {
        const files = [createFile('///design/context.md', '# Design')]

        const result = await service.sync({files})

        expect(result.added).to.deep.equal(['design/context.md'])
      })
    })

    describe('editing files', () => {
      it('should edit existing file', async () => {
        // Setup existing file in local state
        const localState = new Map<string, FileState>()
        localState.set('design/context.md', {hash: 'oldhash', size: 10})
        mockSnapshotService.getCurrentState.resolves(localState)

        // Create the actual file
        await mkdir(join(contextTreeDir, 'design'), {recursive: true})
        await writeFile(join(contextTreeDir, 'design/context.md'), '# Old content')

        const files = [createFile('design/context.md', '# New content')]

        const result = await service.sync({files})

        expect(result.added).to.be.empty
        expect(result.edited).to.deep.equal(['design/context.md'])
        expect(result.deleted).to.be.empty

        const content = await readFile(join(contextTreeDir, 'design/context.md'), 'utf8')
        expect(content).to.equal('# New content')
      })

      it('should edit multiple existing files', async () => {
        const localState = new Map<string, FileState>()
        localState.set('design/context.md', {hash: 'hash1', size: 10})
        localState.set('code/context.md', {hash: 'hash2', size: 10})
        mockSnapshotService.getCurrentState.resolves(localState)

        // Create the actual files
        await mkdir(join(contextTreeDir, 'design'), {recursive: true})
        await mkdir(join(contextTreeDir, 'code'), {recursive: true})
        await writeFile(join(contextTreeDir, 'design/context.md'), '# Old Design')
        await writeFile(join(contextTreeDir, 'code/context.md'), '# Old Code')

        const files = [createFile('design/context.md', '# New Design'), createFile('code/context.md', '# New Code')]

        const result = await service.sync({files})

        expect(result.edited).to.have.lengthOf(2)
        expect(result.edited).to.include('design/context.md')
        expect(result.edited).to.include('code/context.md')
      })

      it('should edit file even if path has leading slash', async () => {
        const localState = new Map<string, FileState>()
        localState.set('design/context.md', {hash: 'oldhash', size: 10})
        mockSnapshotService.getCurrentState.resolves(localState)

        // Create the actual file
        await mkdir(join(contextTreeDir, 'design'), {recursive: true})
        await writeFile(join(contextTreeDir, 'design/context.md'), '# Old')

        const files = [createFile('/design/context.md', '# Updated')]

        const result = await service.sync({files})

        expect(result.edited).to.deep.equal(['design/context.md'])
      })

      it('should not count as edited when content is unchanged', async () => {
        const localState = new Map<string, FileState>()
        localState.set('design/context.md', {hash: 'hash', size: 10})
        mockSnapshotService.getCurrentState.resolves(localState)

        // Create the actual file with same content as remote
        await mkdir(join(contextTreeDir, 'design'), {recursive: true})
        await writeFile(join(contextTreeDir, 'design/context.md'), '# Same content')

        const files = [createFile('design/context.md', '# Same content')]

        const result = await service.sync({files})

        expect(result.added).to.be.empty
        expect(result.edited).to.be.empty
        expect(result.deleted).to.be.empty
      })
    })

    describe('deleting files', () => {
      it('should delete local file not in remote', async () => {
        const localState = new Map<string, FileState>()
        localState.set('old_domain/context.md', {hash: 'hash', size: 10})
        mockSnapshotService.getCurrentState.resolves(localState)

        // Create the actual file
        await mkdir(join(contextTreeDir, 'old_domain'), {recursive: true})
        await writeFile(join(contextTreeDir, 'old_domain/context.md'), '# Old')

        const result = await service.sync({files: []})

        expect(result.added).to.be.empty
        expect(result.edited).to.be.empty
        expect(result.deleted).to.deep.equal(['old_domain/context.md'])
      })

      it('should delete multiple files not in remote', async () => {
        const localState = new Map<string, FileState>()
        localState.set('old1/context.md', {hash: 'hash1', size: 10})
        localState.set('old2/context.md', {hash: 'hash2', size: 10})
        mockSnapshotService.getCurrentState.resolves(localState)

        await mkdir(join(contextTreeDir, 'old1'), {recursive: true})
        await mkdir(join(contextTreeDir, 'old2'), {recursive: true})
        await writeFile(join(contextTreeDir, 'old1/context.md'), '# Old 1')
        await writeFile(join(contextTreeDir, 'old2/context.md'), '# Old 2')

        const result = await service.sync({files: []})

        expect(result.deleted).to.have.lengthOf(2)
        expect(result.deleted).to.include('old1/context.md')
        expect(result.deleted).to.include('old2/context.md')
      })
    })

    describe('mixed operations', () => {
      it('should handle add, edit, and delete in single sync', async () => {
        const localState = new Map<string, FileState>()
        localState.set('existing/context.md', {hash: 'hash1', size: 10})
        localState.set('to_delete/context.md', {hash: 'hash2', size: 10})
        mockSnapshotService.getCurrentState.resolves(localState)

        await mkdir(join(contextTreeDir, 'existing'), {recursive: true})
        await mkdir(join(contextTreeDir, 'to_delete'), {recursive: true})
        await writeFile(join(contextTreeDir, 'existing/context.md'), '# Old')
        await writeFile(join(contextTreeDir, 'to_delete/context.md'), '# Delete me')

        const files = [createFile('existing/context.md', '# Updated'), createFile('new/context.md', '# New file')]

        const result = await service.sync({files})

        expect(result.added).to.deep.equal(['new/context.md'])
        expect(result.edited).to.deep.equal(['existing/context.md'])
        expect(result.deleted).to.deep.equal(['to_delete/context.md'])
      })
    })

    describe('empty snapshot', () => {
      it('should handle empty files array with empty local state', async () => {
        const result = await service.sync({files: []})

        expect(result.added).to.be.empty
        expect(result.edited).to.be.empty
        expect(result.deleted).to.be.empty
      })

      it('should delete all local files when remote is empty', async () => {
        const localState = new Map<string, FileState>()
        localState.set('file1/context.md', {hash: 'hash1', size: 10})
        localState.set('file2/context.md', {hash: 'hash2', size: 10})
        mockSnapshotService.getCurrentState.resolves(localState)

        await mkdir(join(contextTreeDir, 'file1'), {recursive: true})
        await mkdir(join(contextTreeDir, 'file2'), {recursive: true})
        await writeFile(join(contextTreeDir, 'file1/context.md'), '# File 1')
        await writeFile(join(contextTreeDir, 'file2/context.md'), '# File 2')

        const result = await service.sync({files: []})

        expect(result.deleted).to.have.lengthOf(2)
      })
    })

    describe('base64 decoding', () => {
      it('should correctly decode base64 content', async () => {
        const content = '# Hello World\n\nThis is test content with special chars: äöü'
        const files = [createFile('test/context.md', content)]

        await service.sync({files})

        const written = await readFile(join(contextTreeDir, 'test/context.md'), 'utf8')
        expect(written).to.equal(content)
      })

      it('should handle empty content', async () => {
        const files = [createFile('empty/context.md', '')]

        const result = await service.sync({files})

        expect(result.added).to.deep.equal(['empty/context.md'])

        const written = await readFile(join(contextTreeDir, 'empty/context.md'), 'utf8')
        expect(written).to.equal('')
      })
    })

    describe('directory parameter', () => {
      it('should use directory parameter over baseDirectory', async () => {
        const otherDir = join(tmpdir(), `brv-other-${Date.now()}`)
        const otherContextDir = join(otherDir, BRV_DIR, CONTEXT_TREE_DIR)
        await mkdir(otherContextDir, {recursive: true})

        try {
          const files = [createFile('test/context.md', '# Test')]

          await service.sync({directory: otherDir, files})

          const content = await readFile(join(otherContextDir, 'test/context.md'), 'utf8')
          expect(content).to.equal('# Test')
        } finally {
          await rm(otherDir, {force: true, recursive: true})
        }
      })

      it('should pass directory to snapshotService.getCurrentState', async () => {
        const otherDir = '/custom/directory'
        mockSnapshotService.getCurrentState.resolves(new Map())

        await service.sync({directory: otherDir, files: []})

        expect(mockSnapshotService.getCurrentState.calledWith(otherDir)).to.be.true
      })
    })

    describe('default directory behavior', () => {
      it('should use baseDirectory from config when no directory param', async () => {
        const files = [createFile('test/context.md', '# Test')]

        await service.sync({files})

        const content = await readFile(join(contextTreeDir, 'test/context.md'), 'utf8')
        expect(content).to.equal('# Test')
      })
    })
  })
})
