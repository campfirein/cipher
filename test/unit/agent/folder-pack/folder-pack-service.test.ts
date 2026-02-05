import {expect} from 'chai'
import {createSandbox, type SinonSandbox, type SinonStub} from 'sinon'

import type {
  FileContent,
  FileMetadata,
  GlobResult,
  ListDirectoryResult,
} from '../../../../src/agent/core/domain/file-system/types.js'
import type {PackProgress} from '../../../../src/agent/core/domain/folder-pack/types.js'
import type {IFileSystem} from '../../../../src/agent/core/interfaces/i-file-system.js'

import {FolderPackService} from '../../../../src/agent/infra/folder-pack/folder-pack-service.js'

describe('FolderPackService', () => {
  let sandbox: SinonSandbox
  let fileSystemMock: IFileSystem
  let initializeStub: SinonStub
  let globFilesStub: SinonStub
  let readFileStub: SinonStub
  let listDirectoryStub: SinonStub

  beforeEach(() => {
    sandbox = createSandbox()

    initializeStub = sandbox.stub()
    globFilesStub = sandbox.stub()
    readFileStub = sandbox.stub()
    listDirectoryStub = sandbox.stub()

    fileSystemMock = {
      editFile: sandbox.stub(),
      globFiles: globFilesStub,
      initialize: initializeStub,
      listDirectory: listDirectoryStub,
      readFile: readFileStub,
      searchContent: sandbox.stub(),
      writeFile: sandbox.stub(),
    } as unknown as IFileSystem
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('initialize', () => {
    it('should initialize the file system service', async () => {
      const service = new FolderPackService(fileSystemMock)
      initializeStub.resolves()

      await service.initialize()

      sandbox.assert.calledOnce(initializeStub)
    })

    it('should not initialize twice', async () => {
      const service = new FolderPackService(fileSystemMock)
      initializeStub.resolves()

      await service.initialize()
      await service.initialize()

      sandbox.assert.calledOnce(initializeStub)
    })
  })

  describe('pack', () => {
    let service: FolderPackService

    beforeEach(async () => {
      service = new FolderPackService(fileSystemMock)
      initializeStub.resolves()
      await service.initialize()
    })

    it('should throw if not initialized', async () => {
      const uninitializedService = new FolderPackService(fileSystemMock)

      try {
        await uninitializedService.pack('/test/folder')
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(Error)
        expect((error as Error).message).to.include('not initialized')
      }
    })

    it('should pack files successfully', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'src/index.ts', size: 100},
        {isDirectory: false, modified: new Date(), path: 'src/utils.ts', size: 200},
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 2,
        truncated: false,
      }

      const mockFileContent: FileContent = {
        content: 'const x = 1;',
        encoding: 'utf8',
        formattedContent: '00001| const x = 1;',
        lines: 1,
        message: 'OK',
        size: 12,
        totalLines: 1,
        truncated: false,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 2,
        entries: [],
        tree: 'src/\n├── index.ts\n└── utils.ts',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      readFileStub.resolves(mockFileContent)
      listDirectoryStub.resolves(mockTreeResult)

      const result = await service.pack('/test/folder')

      expect(result.fileCount).to.equal(2)
      expect(result.files).to.have.length(2)
      expect(result.skippedFiles).to.have.length(0)
      expect(result.directoryTree).to.include('index.ts')
      expect(result.totalCharacters).to.be.greaterThan(0)
    })

    it('should skip files exceeding size limit', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'small.ts', size: 100},
        {isDirectory: false, modified: new Date(), path: 'large.bin', size: 20 * 1024 * 1024}, // 20MB
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 2,
        truncated: false,
      }

      const mockFileContent: FileContent = {
        content: 'small content',
        encoding: 'utf8',
        formattedContent: '00001| small content',
        lines: 1,
        message: 'OK',
        size: 13,
        totalLines: 1,
        truncated: false,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 2,
        entries: [],
        tree: '.',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      readFileStub.resolves(mockFileContent)
      listDirectoryStub.resolves(mockTreeResult)

      const result = await service.pack('/test/folder')

      expect(result.fileCount).to.equal(1)
      expect(result.skippedCount).to.equal(1)
      expect(result.skippedFiles[0].reason).to.equal('size-limit')
      expect(result.skippedFiles[0].path).to.equal('large.bin')
    })

    it('should skip files with read errors', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'good.ts', size: 100},
        {isDirectory: false, modified: new Date(), path: 'bad.ts', size: 100},
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 2,
        truncated: false,
      }

      const mockFileContent: FileContent = {
        content: 'good content',
        encoding: 'utf8',
        formattedContent: '00001| good content',
        lines: 1,
        message: 'OK',
        size: 12,
        totalLines: 1,
        truncated: false,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 2,
        entries: [],
        tree: '.',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      // First call succeeds, second fails
      readFileStub.onCall(0).resolves(mockFileContent)
      readFileStub.onCall(1).rejects(new Error('Permission denied'))
      listDirectoryStub.resolves(mockTreeResult)

      const result = await service.pack('/test/folder')

      expect(result.fileCount).to.equal(1)
      expect(result.skippedCount).to.equal(1)
      expect(result.skippedFiles[0].reason).to.equal('permission')
      expect(result.skippedFiles[0].path).to.equal('bad.ts')
    })

    it('should categorize binary file errors correctly', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'data.bin', size: 100},
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 1,
        truncated: false,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 1,
        entries: [],
        tree: '.',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      readFileStub.rejects(new Error('Binary file detected'))
      listDirectoryStub.resolves(mockTreeResult)

      const result = await service.pack('/test/folder')

      expect(result.skippedCount).to.equal(1)
      expect(result.skippedFiles[0].reason).to.equal('binary')
    })

    it('should call progress callback during pack operation', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'file.ts', size: 100},
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 1,
        truncated: false,
      }

      const mockFileContent: FileContent = {
        content: 'content',
        encoding: 'utf8',
        formattedContent: '00001| content',
        lines: 1,
        message: 'OK',
        size: 7,
        totalLines: 1,
        truncated: false,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 1,
        entries: [],
        tree: '.',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      readFileStub.resolves(mockFileContent)
      listDirectoryStub.resolves(mockTreeResult)

      const progressUpdates: PackProgress[] = []
      const progressCallback = (progress: PackProgress) => {
        progressUpdates.push(progress)
      }

      await service.pack('/test/folder', undefined, progressCallback)

      // Check for expected phases
      const phases = progressUpdates.map((p) => p.phase)
      expect(phases).to.include('searching')
      expect(phases).to.include('collecting')
      expect(phases).to.include('generating')
    })

    it('should merge custom config with defaults', async () => {
      const mockFiles: FileMetadata[] = []

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 0,
        truncated: false,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 0,
        entries: [],
        tree: '.',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      listDirectoryStub.resolves(mockTreeResult)

      const customConfig = {
        maxFileSize: 5 * 1024 * 1024, // 5MB
        useGitignore: false,
      }

      const result = await service.pack('/test/folder', customConfig)

      expect(result.config.maxFileSize).to.equal(5 * 1024 * 1024)
      expect(result.config.useGitignore).to.equal(false)
      // Default values should still be present
      expect(result.config.includeTree).to.equal(true)
      expect(result.config.extractPdfText).to.equal(true)
    })

    it('should detect PDF files correctly', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'doc.pdf', size: 100},
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 1,
        truncated: false,
      }

      const mockFileContent: FileContent = {
        content: 'PDF extracted text',
        encoding: 'utf8',
        formattedContent: '00001| PDF extracted text',
        lines: 1,
        message: 'OK',
        pdfPages: [{pageNumber: 1, text: 'PDF extracted text'}],
        size: 18,
        totalLines: 1,
        truncated: false,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 1,
        entries: [],
        tree: '.',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      readFileStub.resolves(mockFileContent)
      listDirectoryStub.resolves(mockTreeResult)

      const result = await service.pack('/test/folder')

      expect(result.files[0].fileType).to.equal('pdf')
    })

    it('should detect file types correctly', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'app.ts', size: 100},
        {isDirectory: false, modified: new Date(), path: 'config.json', size: 100},
        {isDirectory: false, modified: new Date(), path: 'README.md', size: 100},
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 3,
        truncated: false,
      }

      const mockFileContent: FileContent = {
        content: 'content',
        encoding: 'utf8',
        formattedContent: '00001| content',
        lines: 1,
        message: 'OK',
        size: 7,
        totalLines: 1,
        truncated: false,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 3,
        entries: [],
        tree: '.',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      readFileStub.resolves(mockFileContent)
      listDirectoryStub.resolves(mockTreeResult)

      const result = await service.pack('/test/folder')

      const fileTypes = result.files.map((f) => ({path: f.path, type: f.fileType}))
      expect(fileTypes).to.deep.include({path: 'app.ts', type: 'code'})
      expect(fileTypes).to.deep.include({path: 'config.json', type: 'config'})
      expect(fileTypes).to.deep.include({path: 'README.md', type: 'doc'})
    })

    it('should filter files matching ignore patterns', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'src/app.ts', size: 100},
        {isDirectory: false, modified: new Date(), path: 'node_modules/lodash/index.js', size: 100},
        {isDirectory: false, modified: new Date(), path: '.git/config', size: 100},
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 3,
        truncated: false,
      }

      const mockFileContent: FileContent = {
        content: 'content',
        encoding: 'utf8',
        formattedContent: '00001| content',
        lines: 1,
        message: 'OK',
        size: 7,
        totalLines: 1,
        truncated: false,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 1,
        entries: [],
        tree: '.',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      readFileStub.resolves(mockFileContent)
      listDirectoryStub.resolves(mockTreeResult)

      const result = await service.pack('/test/folder')

      // Only src/app.ts should be included
      expect(result.fileCount).to.equal(1)
      expect(result.files[0].path).to.equal('src/app.ts')
    })

    it('should handle truncated file content', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'large.ts', size: 100},
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 1,
        truncated: false,
      }

      const mockFileContent: FileContent = {
        content: 'truncated content...',
        encoding: 'utf8',
        formattedContent: '00001| truncated content...',
        lines: 10_000,
        message: 'Content truncated',
        size: 20,
        totalLines: 50_000,
        truncated: true,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 1,
        entries: [],
        tree: '.',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      readFileStub.resolves(mockFileContent)
      listDirectoryStub.resolves(mockTreeResult)

      const result = await service.pack('/test/folder')

      expect(result.files[0].truncated).to.equal(true)
    })

    it('should handle tree generation failure gracefully', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'file.ts', size: 100},
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 1,
        truncated: false,
      }

      const mockFileContent: FileContent = {
        content: 'content',
        encoding: 'utf8',
        formattedContent: '00001| content',
        lines: 1,
        message: 'OK',
        size: 7,
        totalLines: 1,
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      readFileStub.resolves(mockFileContent)
      listDirectoryStub.rejects(new Error('Tree generation failed'))

      const result = await service.pack('/test/folder')

      expect(result.fileCount).to.equal(1)
      expect(result.directoryTree).to.include('Unable to generate')
    })

    it('should skip tree generation when includeTree is false', async () => {
      const mockFiles: FileMetadata[] = []

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 0,
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)

      const result = await service.pack('/test/folder', {includeTree: false})

      sandbox.assert.notCalled(listDirectoryStub)
      expect(result.directoryTree).to.equal('')
    })
  })

  describe('generateXml', () => {
    let service: FolderPackService

    beforeEach(async () => {
      service = new FolderPackService(fileSystemMock)
      initializeStub.resolves()
      await service.initialize()
    })

    it('should generate XML from pack result', async () => {
      const mockFiles: FileMetadata[] = [
        {isDirectory: false, modified: new Date(), path: 'test.ts', size: 100},
      ]

      const mockGlobResult: GlobResult = {
        files: mockFiles,
        ignoredCount: 0,
        totalFound: 1,
        truncated: false,
      }

      const mockFileContent: FileContent = {
        content: 'const x = 1;',
        encoding: 'utf8',
        formattedContent: '00001| const x = 1;',
        lines: 1,
        message: 'OK',
        size: 12,
        totalLines: 1,
        truncated: false,
      }

      const mockTreeResult: ListDirectoryResult = {
        count: 1,
        entries: [],
        tree: 'test.ts',
        truncated: false,
      }

      globFilesStub.resolves(mockGlobResult)
      readFileStub.resolves(mockFileContent)
      listDirectoryStub.resolves(mockTreeResult)

      const packResult = await service.pack('/test/folder')
      const xml = service.generateXml(packResult)

      expect(xml).to.include('<?xml version="1.0" encoding="UTF-8"?>')
      expect(xml).to.include('<packed_folder>')
      expect(xml).to.include('<metadata>')
      expect(xml).to.include('<files>')
      expect(xml).to.include('</packed_folder>')
    })
  })
})
