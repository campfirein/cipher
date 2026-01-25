import { expect } from 'chai'
import { createSandbox, SinonStub } from 'sinon'

import type { IFileSystem } from '../../../../src/agent/interfaces/i-file-system.js'
import type { GlobFilesResult, GrepContentResult } from '../../../shared/tool-result-types.js'

import { createEditFileTool } from '../../../../src/agent/tools/implementations/edit-file-tool.js'
import { createGlobFilesTool } from '../../../../src/agent/tools/implementations/glob-files-tool.js'
import { createGrepContentTool } from '../../../../src/agent/tools/implementations/grep-content-tool.js'
import { createReadFileTool } from '../../../../src/agent/tools/implementations/read-file-tool.js'
import { createWriteFileTool } from '../../../../src/agent/tools/implementations/write-file-tool.js'

// Type assertion functions
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

describe('File System Tools', () => {
  const sandbox = createSandbox()
  let fileSystemMock: IFileSystem
  let editFileStub: SinonStub
  let globFilesStub: SinonStub
  let readFileStub: SinonStub
  let searchContentStub: SinonStub
  let writeFileStub: SinonStub

  beforeEach(() => {
    editFileStub = sandbox.stub()
    globFilesStub = sandbox.stub()
    readFileStub = sandbox.stub()
    searchContentStub = sandbox.stub()
    writeFileStub = sandbox.stub()

    fileSystemMock = {
      editFile: editFileStub,
      globFiles: globFilesStub,
      readFile: readFileStub,
      searchContent: searchContentStub,
      writeFile: writeFileStub,
    } as unknown as IFileSystem
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('read_file', () => {
    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('should read file content successfully', async () => {
      const tool = createReadFileTool(fileSystemMock)
      const mockServiceResult = {
        content: 'file content',
        encoding: 'utf8',
        formattedContent: '00001| file content',
        lines: 1,
        message: 'File read successfully',
        size: 12,
        totalLines: 1,
        truncated: false,
        truncatedLineCount: undefined,
      }
      readFileStub.resolves(mockServiceResult)

      const result = await tool.execute({ filePath: '/path/to/file' })

      sandbox.assert.calledWith(readFileStub, '/path/to/file', sandbox.match({ limit: undefined, offset: undefined }))
      // Tool returns formattedContent as content, plus message and totalLines
      // Also includes attachment and preview fields (undefined when not applicable)
      expect(result).to.deep.equal({
        attachment: undefined,
        content: '00001| file content',
        lines: 1,
        message: 'File read successfully',
        preview: undefined,
        size: 12,
        totalLines: 1,
        truncated: false,
      })
    })

    it('should handle pagination parameters', async () => {
      const tool = createReadFileTool(fileSystemMock)
      readFileStub.resolves({ content: 'content' })

      await tool.execute({ filePath: '/path/to/file', limit: 10, offset: 5 })

      sandbox.assert.calledWith(readFileStub, '/path/to/file', sandbox.match({ limit: 10, offset: 5 }))
    })

    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('should return pagination metadata when file is truncated', async () => {
      const tool = createReadFileTool(fileSystemMock)
      const mockResult = {
        content: 'truncated content',
        encoding: 'utf8',
        lines: 50,
        pagination: {
          hint: 'File truncated. To continue reading, use offset: 51',
          linesShown: [1, 50] as [number, number],
          nextOffset: 51,
          totalLines: 100,
        },
        size: 1000,
        truncated: true,
        truncatedLineCount: undefined,
      }
      readFileStub.resolves(mockResult)

      const result = await tool.execute({ filePath: '/path/to/large-file', limit: 50 })

      expect(result).to.deep.equal(mockResult)
    })

    // eslint-disable-next-line mocha/no-skipped-tests
    it.skip('should return truncatedLineCount when lines are too long', async () => {
      const tool = createReadFileTool(fileSystemMock)
      const mockResult = {
        content: 'content with truncated lines',
        encoding: 'utf8',
        lines: 5,
        pagination: undefined,
        size: 500,
        truncated: false,
        truncatedLineCount: 2,
      }
      readFileStub.resolves(mockResult)

      const result = await tool.execute({ filePath: '/path/to/long-lines-file' })

      expect(result).to.deep.equal(mockResult)
    })

    it('should propagate file not found error', async () => {
      const tool = createReadFileTool(fileSystemMock)
      const error = new Error('File not found')
      error.name = 'FileNotFoundError'
      readFileStub.rejects(error)

      const result = await tool.execute({ filePath: '/missing/file' })

      expect(result).to.have.property('success', false)
      expect(result).to.have.property('error').that.includes('File not found')
    })

    it('should propagate file too large error', async () => {
      const tool = createReadFileTool(fileSystemMock)
      const error = new Error('File too large')
      error.name = 'FileTooLargeError'
      readFileStub.rejects(error)

      const result = await tool.execute({ filePath: '/large/file' })

      expect(result).to.have.property('success', false)
      expect(result).to.have.property('error').that.includes('File too large')
    })

    it('should propagate path not allowed error', async () => {
      const tool = createReadFileTool(fileSystemMock)
      const error = new Error('Path not allowed')
      error.name = 'PathNotAllowedError'
      readFileStub.rejects(error)

      const result = await tool.execute({ filePath: '/forbidden/path' })

      expect(result).to.have.property('success', false)
      expect(result).to.have.property('error').that.includes('Path not allowed')
    })
  })

  describe('write_file', () => {
    it('should write file content successfully', async () => {
      const tool = createWriteFileTool(fileSystemMock)
      const mockResult = {
        bytesWritten: 12,
        path: '/path/to/file',
        success: true,
      }
      writeFileStub.resolves(mockResult)

      const result = await tool.execute({
        content: 'new content',
        filePath: '/path/to/file',
      })

      sandbox.assert.calledWith(
        writeFileStub,
        '/path/to/file',
        'new content',
        sandbox.match({ createDirs: undefined, encoding: undefined }),
      )
      expect(result).to.deep.equal(mockResult)
    })

    it('should handle createDirs option', async () => {
      const tool = createWriteFileTool(fileSystemMock)
      writeFileStub.resolves({})

      await tool.execute({
        content: 'content',
        createDirs: true,
        filePath: '/path/to/file',
      })

      expect(writeFileStub.args[0][2]).to.include({ createDirs: true })
    })

    it('should propagate invalid extension error', async () => {
      const tool = createWriteFileTool(fileSystemMock)
      const error = new Error('Invalid extension')
      error.name = 'InvalidExtensionError'
      writeFileStub.rejects(error)

      try {
        await tool.execute({ content: 'data', filePath: '/path/file.exe' })
        expect.fail('Should have thrown an error')
      } catch (error: unknown) {
        expect(error instanceof Error).to.be.true
        if (error instanceof Error) {
          expect(error.message).to.include('Invalid extension')
        }
      }
    })

    it('should propagate path blocked error', async () => {
      const tool = createWriteFileTool(fileSystemMock)
      const error = new Error('Path blocked')
      error.name = 'PathBlockedError'
      writeFileStub.rejects(error)

      try {
        await tool.execute({ content: 'data', filePath: '.env' })
        expect.fail('Should have thrown an error')
      } catch (error: unknown) {
        expect(error instanceof Error).to.be.true
        if (error instanceof Error) {
          expect(error.message).to.include('Path blocked')
        }
      }
    })
  })

  describe('edit_file', () => {
    it('should edit file content successfully', async () => {
      const tool = createEditFileTool(fileSystemMock)
      const mockResult = {
        bytesWritten: 20,
        path: '/path/to/file',
        replacements: 1,
        success: true,
      }
      editFileStub.resolves(mockResult)

      const result = await tool.execute({
        filePath: '/path/to/file',
        newString: 'new',
        oldString: 'old',
      })

      sandbox.assert.calledWith(
        editFileStub,
        '/path/to/file',
        sandbox.match({ newString: 'new', oldString: 'old', replaceAll: undefined }),
        sandbox.match({}),
      )
      expect(result).to.deep.equal(mockResult)
    })

    it('should handle replaceAll option', async () => {
      const tool = createEditFileTool(fileSystemMock)
      editFileStub.resolves({})

      await tool.execute({
        filePath: '/path/to/file',
        newString: 'new',
        oldString: 'old',
        replaceAll: true,
      })

      expect(editFileStub.args[0][1]).to.include({ replaceAll: true })
    })

    it('should propagate string not found error', async () => {
      const tool = createEditFileTool(fileSystemMock)
      const error = new Error('String not found')
      error.name = 'StringNotFoundError'
      editFileStub.rejects(error)

      try {
        await tool.execute({
          filePath: '/path/file',
          newString: 'new',
          oldString: 'missing',
        })
        expect.fail('Should have thrown an error')
      } catch (error: unknown) {
        expect(error instanceof Error).to.be.true
        if (error instanceof Error) {
          expect(error.message).to.include('String not found')
        }
      }
    })

    it('should propagate string not unique error', async () => {
      const tool = createEditFileTool(fileSystemMock)
      const error = new Error('String not unique')
      error.name = 'StringNotUniqueError'
      editFileStub.rejects(error)

      try {
        await tool.execute({
          filePath: '/path/file',
          newString: 'new',
          oldString: 'duplicate',
        })
        expect.fail('Should have thrown an error')
      } catch (error: unknown) {
        expect(error instanceof Error).to.be.true
        if (error instanceof Error) {
          expect(error.message).to.include('String not unique')
        }
      }
    })
  })

  describe('glob_files', () => {
    it('should find files matching pattern', async () => {
      const tool = createGlobFilesTool(fileSystemMock)
      const date = new Date()
      const mockResult = {
        files: [
          { modified: date, path: '/path/to/file1.ts', size: 100 },
          { modified: date, path: '/path/to/file2.ts', size: 200 },
        ],
        totalFound: 2,
        truncated: false,
      }
      globFilesStub.resolves(mockResult)

      const result = await tool.execute({ pattern: '*.ts' })
      assertGlobFilesResult(result)

      sandbox.assert.calledWith(
        globFilesStub,
        '*.ts',
        sandbox.match({ cwd: undefined, includeMetadata: true, maxResults: undefined }),
      )
      expect(result.files).to.have.length(2)
      expect(result.files[0].path).to.equal('/path/to/file1.ts')
      expect(result.files[0].modified).to.equal(date.toISOString())
    })

    it('should handle path and maxResults parameters', async () => {
      const tool = createGlobFilesTool(fileSystemMock)
      globFilesStub.resolves({ files: [] })

      await tool.execute({ maxResults: 50, path: '/base/path', pattern: '*.ts' })

      sandbox.assert.calledWith(
        globFilesStub,
        '*.ts',
        sandbox.match({ cwd: '/base/path', includeMetadata: true, maxResults: 50 }),
      )
    })

    it('should propagate invalid pattern error', async () => {
      const tool = createGlobFilesTool(fileSystemMock)
      const error = new Error('Invalid pattern')
      error.name = 'InvalidPatternError'
      globFilesStub.rejects(error)

      try {
        await tool.execute({ pattern: '[invalid' })
        expect.fail('Should have thrown an error')
      } catch (error: unknown) {
        expect(error instanceof Error).to.be.true
        if (error instanceof Error) {
          expect(error.message).to.include('Invalid pattern')
        }
      }
    })

    it('should handle truncated results', async () => {
      const tool = createGlobFilesTool(fileSystemMock)
      const mockResult = {
        files: [],
        totalFound: 1500,
        truncated: true,
      }
      globFilesStub.resolves(mockResult)

      const result = await tool.execute({ maxResults: 100, pattern: '**/*' })
      assertGlobFilesResult(result)

      expect(result.truncated).to.be.true
      expect(result.totalFound).to.equal(1500)
    })
  })

  describe('grep_content', () => {
    it('should search content successfully', async () => {
      const tool = createGrepContentTool(fileSystemMock)
      const mockResult = {
        filesSearched: 10,
        matches: [
          {
            context: { after: [], before: [] },
            file: '/path/to/file.ts',
            line: 'const x = 1',
            lineNumber: 5,
          },
        ],
        totalMatches: 1,
        truncated: false,
      }
      searchContentStub.resolves(mockResult)

      const result = await tool.execute({ pattern: 'const x' })
      assertGrepContentResult(result)

      sandbox.assert.calledWith(
        searchContentStub,
        'const x',
        sandbox.match({
          caseInsensitive: undefined,
          contextLines: undefined,
          cwd: undefined,
          globPattern: undefined,
          maxResults: undefined,
        }),
      )
      expect(result.matches).to.have.length(1)
      expect(result.matches[0].file).to.equal('/path/to/file.ts')
    })

    it('should handle all options', async () => {
      const tool = createGrepContentTool(fileSystemMock)
      searchContentStub.resolves({ matches: [] })

      await tool.execute({
        caseInsensitive: true,
        contextLines: 2,
        glob: '*.ts',
        maxResults: 50,
        path: '/base/path',
        pattern: 'test',
      })

      sandbox.assert.calledWith(
        searchContentStub,
        'test',
        sandbox.match({
          caseInsensitive: true,
          contextLines: 2,
          cwd: '/base/path',
          globPattern: '*.ts',
          maxResults: 50,
        }),
      )
    })

    it('should propagate invalid regex pattern error', async () => {
      const tool = createGrepContentTool(fileSystemMock)
      const error = new Error('Invalid pattern')
      error.name = 'InvalidPatternError'
      searchContentStub.rejects(error)

      try {
        await tool.execute({ pattern: '(unclosed' })
        expect.fail('Should have thrown an error')
      } catch (error: unknown) {
        expect(error instanceof Error).to.be.true
        if (error instanceof Error) {
          expect(error.message).to.include('Invalid pattern')
        }
      }
    })

    it('should handle truncated search results', async () => {
      const tool = createGrepContentTool(fileSystemMock)
      const mockResult = {
        filesSearched: 100,
        matches: [],
        totalMatches: 250,
        truncated: true,
      }
      searchContentStub.resolves(mockResult)

      const result = await tool.execute({ maxResults: 50, pattern: 'test' })
      assertGrepContentResult(result)

      expect(result.truncated).to.be.true
      expect(result.totalMatches).to.equal(250)
    })
  })
})
