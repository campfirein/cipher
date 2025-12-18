import {expect} from 'chai'
import {mkdir, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {
  EditFileResult,
  GlobFilesResult,
  GrepContentResult,
  ReadFileResult,
  WriteFileResult,
} from '../../../../shared/tool-result-types.js'

import {FileSystemService} from '../../../../../src/infra/cipher/file-system/file-system-service.js'
import {createEditFileTool} from '../../../../../src/infra/cipher/tools/implementations/edit-file-tool.js'
import {createGlobFilesTool} from '../../../../../src/infra/cipher/tools/implementations/glob-files-tool.js'
import {createGrepContentTool} from '../../../../../src/infra/cipher/tools/implementations/grep-content-tool.js'
import {createReadFileTool} from '../../../../../src/infra/cipher/tools/implementations/read-file-tool.js'
import {createWriteFileTool} from '../../../../../src/infra/cipher/tools/implementations/write-file-tool.js'

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

function assertEditFileResult(result: unknown): asserts result is EditFileResult {
  if (typeof result !== 'object' || result === null || !('success' in result) || !('replacements' in result)) {
    throw new Error('Expected EditFileResult')
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

  describe('edit_file', () => {
    it('should edit file content', async () => {
      const filePath = join(testDir, 'edit.txt')
      await writeFile(filePath, 'Hello Old World')

      const tool = createEditFileTool(fileSystemService)
      const result = await tool.execute({
        filePath,
        newString: 'New',
        oldString: 'Old',
      })
      assertEditFileResult(result)

      expect(result.success).to.be.true
      expect(result.replacements).to.equal(1)

      // Verify content
      const readTool = createReadFileTool(fileSystemService)
      const readResult = await readTool.execute({filePath})
      assertReadFileResult(readResult)
      // Content is now formatted with line numbers
      expect(readResult.content).to.include('Hello New World')
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
})
