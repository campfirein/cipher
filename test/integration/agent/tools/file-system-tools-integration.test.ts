import {expect} from 'chai'
import {mkdir, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {
  GlobFilesResult,
  GrepContentResult,
  ReadFileResult,
  WriteFileResult,
} from '../../../shared/tool-result-types.js'

import {FileSystemService} from '../../../../src/agent/infra/file-system/file-system-service.js'
import {createGlobFilesTool} from '../../../../src/agent/infra/tools/implementations/glob-files-tool.js'
import {createGrepContentTool} from '../../../../src/agent/infra/tools/implementations/grep-content-tool.js'
import {createReadFileTool} from '../../../../src/agent/infra/tools/implementations/read-file-tool.js'
import {createWriteFileTool} from '../../../../src/agent/infra/tools/implementations/write-file-tool.js'
import {generateMultiPagePdf, generatePdf, generateSinglePagePdf} from '../../../helpers/pdf-generator.js'

// Type assertion functions
function assertReadFileResult(result: unknown): asserts result is ReadFileResult {
  if (typeof result !== 'object' || result === null || !('content' in result)) {
    throw new Error('Expected ReadFileResult')
  }
}

function assertWriteFileResult(result: unknown): asserts result is WriteFileResult {
  if (typeof result !== 'object' || result === null || !('success' in result)) {
    throw new Error('Expected WriteFileResult')
  }
}

function assertGlobFilesResult(result: unknown): asserts result is GlobFilesResult {
  if (typeof result !== 'object' || result === null || !('files' in result)) {
    throw new Error('Expected GlobFilesResult')
  }
}

function assertGrepContentResult(result: unknown): asserts result is GrepContentResult {
  if (typeof result !== 'object' || result === null || !('matches' in result)) {
    throw new Error('Expected GrepContentResult')
  }
}

describe('File System Tools Integration', () => {
  let testDir: string
  let fileSystemService: FileSystemService

  beforeEach(async () => {
    const tmp = await realpath(tmpdir())
    testDir = join(tmp, `byterover-test-${Date.now()}-${Math.random().toString(36).slice(7)}`)
    await mkdir(testDir, {recursive: true})

    fileSystemService = new FileSystemService({
      allowedPaths: [testDir],
    })
    await fileSystemService.initialize()
  })

  afterEach(async () => {
    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('read_file', () => {
    it('should read file content', async () => {
      const filePath = join(testDir, 'test.txt')
      await writeFile(filePath, 'Hello World')

      const tool = createReadFileTool(fileSystemService)
      const result = await tool.execute({filePath})
      assertReadFileResult(result)

      // Content is now formatted with line numbers (e.g., "00001| Hello World")
      expect(result.content).to.include('Hello World')
      expect(result.size).to.equal(11)
    })
  })

  describe('write_file', () => {
    it('should write file content', async () => {
      const filePath = join(testDir, 'output.txt')
      const tool = createWriteFileTool(fileSystemService)

      const result = await tool.execute({
        content: 'New Content',
        filePath,
      })
      assertWriteFileResult(result)

      expect(result.success).to.be.true

      // Verify with tool
      const readTool = createReadFileTool(fileSystemService)
      const readResult = await readTool.execute({filePath})
      assertReadFileResult(readResult)
      // Content is now formatted with line numbers
      expect(readResult.content).to.include('New Content')
    })
  })

  describe('glob_files', () => {
    it('should find files', async () => {
      await writeFile(join(testDir, 'a.ts'), '')
      await writeFile(join(testDir, 'b.js'), '')
      await mkdir(join(testDir, 'subdir'))
      await writeFile(join(testDir, 'subdir/c.ts'), '')

      const tool = createGlobFilesTool(fileSystemService)
      const result = await tool.execute({
        path: testDir,
        pattern: '**/*.ts',
      })
      assertGlobFilesResult(result)

      expect(result.totalFound).to.equal(2)
      expect(result.files).to.have.length(2)
      const paths = result.files.map((f) => f.path).sort()
      expect(paths[0]).to.include('a.ts')
      expect(paths[1]).to.include('c.ts')
    })
  })

  describe('grep_content', () => {
    it('should search content', async () => {
      await writeFile(join(testDir, 'file1.txt'), 'foo bar baz')
      await writeFile(join(testDir, 'file2.txt'), 'hello world')
      await writeFile(join(testDir, 'file3.txt'), 'another foo here')

      const tool = createGrepContentTool(fileSystemService)
      const result = await tool.execute({
        path: testDir,
        pattern: 'foo',
      })
      assertGrepContentResult(result)

      expect(result.totalMatches).to.equal(2)
      expect(result.matches).to.have.length(2)
      const files = result.matches.map((m) => m.file).sort()
      expect(files[0]).to.include('file1.txt')
      expect(files[1]).to.include('file3.txt')
    })
  })

  describe('read_file with PDF text extraction', () => {
    it('should extract text from single-page PDF', async () => {
      const pdfBuffer = await generateSinglePagePdf('Hello World from PDF')
      const filePath = join(testDir, 'single-page.pdf')
      await writeFile(filePath, pdfBuffer)

      const tool = createReadFileTool(fileSystemService)
      const result = await tool.execute({filePath, pdfMode: 'text'})
      assertReadFileResult(result)

      expect(result.success).to.be.true
      expect(result.content).to.include('Hello World from PDF')
      expect(result.content).to.include('--- Page 1 ---')
      expect(result.pdfMetadata).to.exist
      expect(result.pdfMetadata!.pageCount).to.equal(1)
    })

    it('should extract text from multi-page PDF', async () => {
      const pdfBuffer = await generatePdf({
        pages: ['First page content', 'Second page content', 'Third page content'],
      })
      const filePath = join(testDir, 'multi-page.pdf')
      await writeFile(filePath, pdfBuffer)

      const tool = createReadFileTool(fileSystemService)
      const result = await tool.execute({filePath, pdfMode: 'text'})
      assertReadFileResult(result)

      expect(result.success).to.be.true
      expect(result.content).to.include('First page content')
      expect(result.content).to.include('Second page content')
      expect(result.content).to.include('Third page content')
      expect(result.content).to.include('--- Page 1 ---')
      expect(result.content).to.include('--- Page 2 ---')
      expect(result.content).to.include('--- Page 3 ---')
      expect(result.pdfMetadata!.pageCount).to.equal(3)
    })

    it('should paginate with limit parameter', async () => {
      const pdfBuffer = await generateMultiPagePdf(5)
      const filePath = join(testDir, 'five-pages.pdf')
      await writeFile(filePath, pdfBuffer)

      const tool = createReadFileTool(fileSystemService)

      // Read first 2 pages
      const result = await tool.execute({filePath, limit: 2, pdfMode: 'text'})
      assertReadFileResult(result)

      expect(result.success).to.be.true
      expect(result.content).to.include('Page 1 content')
      expect(result.content).to.include('Page 2 content')
      expect(result.content).not.to.include('Page 3 content')
      expect(result.truncated).to.be.true
      expect(result.message).to.include('offset=3')
    })

    it('should paginate with offset parameter', async () => {
      const pdfBuffer = await generateMultiPagePdf(5)
      const filePath = join(testDir, 'five-pages-offset.pdf')
      await writeFile(filePath, pdfBuffer)

      const tool = createReadFileTool(fileSystemService)

      // Read pages 3-4 (offset=3, limit=2)
      const result = await tool.execute({filePath, limit: 2, offset: 3, pdfMode: 'text'})
      assertReadFileResult(result)

      expect(result.success).to.be.true
      expect(result.content).not.to.include('Page 1 content')
      expect(result.content).not.to.include('Page 2 content')
      expect(result.content).to.include('Page 3 content')
      expect(result.content).to.include('Page 4 content')
      expect(result.content).not.to.include('Page 5 content')
      expect(result.truncated).to.be.true
      expect(result.message).to.include('offset=5')
    })

    it('should read remaining pages and show end of file', async () => {
      const pdfBuffer = await generateMultiPagePdf(3)
      const filePath = join(testDir, 'three-pages.pdf')
      await writeFile(filePath, pdfBuffer)

      const tool = createReadFileTool(fileSystemService)

      // Read last page (offset=3)
      const result = await tool.execute({filePath, offset: 3, pdfMode: 'text'})
      assertReadFileResult(result)

      expect(result.success).to.be.true
      expect(result.content).to.include('Page 3 content')
      expect(result.truncated).to.be.false
      expect(result.content).to.include('End of PDF')
    })

    it('should extract PDF metadata', async () => {
      const pdfBuffer = await generatePdf({
        author: 'Test Author',
        pages: ['Content here'],
        title: 'Test Document Title',
      })
      const filePath = join(testDir, 'with-metadata.pdf')
      await writeFile(filePath, pdfBuffer)

      const tool = createReadFileTool(fileSystemService)
      const result = await tool.execute({filePath, pdfMode: 'text'})
      assertReadFileResult(result)

      expect(result.success).to.be.true
      expect(result.pdfMetadata).to.exist
      expect(result.pdfMetadata!.title).to.equal('Test Document Title')
      expect(result.pdfMetadata!.author).to.equal('Test Author')
      expect(result.pdfMetadata!.pageCount).to.equal(1)
    })

    it('should return base64 attachment when pdfMode is base64', async () => {
      const pdfBuffer = await generateSinglePagePdf('PDF content')
      const filePath = join(testDir, 'base64-mode.pdf')
      await writeFile(filePath, pdfBuffer)

      const tool = createReadFileTool(fileSystemService)
      const result = await tool.execute({filePath, pdfMode: 'base64'})
      assertReadFileResult(result)

      expect(result.success).to.be.true
      expect(result.attachments).to.exist
      expect(result.attachments).to.have.length(1)
      expect(result.attachments![0].mimeType).to.equal('application/pdf')
      expect(result.attachments![0].type).to.equal('file')
      expect(result.attachments![0].data).to.be.a('string')
      // Verify it's valid base64 by decoding by checking its magic bytes
      const decoded = Buffer.from(result.attachments![0].data, 'base64')
      expect(decoded.subarray(0, 5).toString()).to.equal('%PDF-')
    })

    it('should default to text mode for PDFs', async () => {
      const pdfBuffer = await generateSinglePagePdf('Default mode test')
      const filePath = join(testDir, 'default-mode.pdf')
      await writeFile(filePath, pdfBuffer)

      const tool = createReadFileTool(fileSystemService)
      // No pdfMode specified - should default to text
      const result = await tool.execute({filePath})
      assertReadFileResult(result)

      expect(result.success).to.be.true
      expect(result.content).to.include('Default mode test')
      expect(result.attachments).to.be.undefined
    })

    it('should handle empty pages gracefully', async () => {
      // Generate PDF with empty pages
      const pdfBuffer = await generatePdf({
        pages: ['', 'Page with content', ''],
      })
      const filePath = join(testDir, 'empty-pages.pdf')
      await writeFile(filePath, pdfBuffer)

      const tool = createReadFileTool(fileSystemService)
      const result = await tool.execute({filePath, pdfMode: 'text'})
      assertReadFileResult(result)

      expect(result.success).to.be.true
      expect(result.content).to.include('--- Page 1 ---')
      expect(result.content).to.include('--- Page 2 ---')
      expect(result.content).to.include('Page with content')
      expect(result.pdfMetadata!.pageCount).to.equal(3)
    })
  })
})
