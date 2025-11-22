import { expect } from 'chai'
import { createSandbox } from 'sinon'

import { createEditFileTool } from '../../../../../src/infra/cipher/tools/implementations/edit-file-tool.js'
import { createGlobFilesTool } from '../../../../../src/infra/cipher/tools/implementations/glob-files-tool.js'
import { createGrepContentTool } from '../../../../../src/infra/cipher/tools/implementations/grep-content-tool.js'
import { createReadFileTool } from '../../../../../src/infra/cipher/tools/implementations/read-file-tool.js'
import { createWriteFileTool } from '../../../../../src/infra/cipher/tools/implementations/write-file-tool.js'
import type { IFileSystem } from '../../../../../src/core/interfaces/cipher/i-file-system.js'

describe('File System Tools', () => {
    const sandbox = createSandbox()
    let fileSystemMock: any

    beforeEach(() => {
        fileSystemMock = {
            editFile: sandbox.stub(),
            globFiles: sandbox.stub(),
            readFile: sandbox.stub(),
            searchContent: sandbox.stub(),
            writeFile: sandbox.stub(),
        }
    })

    afterEach(() => {
        sandbox.restore()
    })

    describe('read_file', () => {
        it('should read file content successfully', async () => {
            const tool = createReadFileTool(fileSystemMock as IFileSystem)
            const mockResult = {
                content: 'file content',
                encoding: 'utf8',
                lines: 1,
                size: 12,
                truncated: false,
            }
            fileSystemMock.readFile.resolves(mockResult)

            const result = await tool.execute({ filePath: '/path/to/file' })

            sandbox.assert.calledWith(fileSystemMock.readFile, '/path/to/file', sandbox.match({ limit: undefined, offset: undefined }))
            expect(result).to.deep.equal(mockResult)
        })

        it('should handle pagination parameters', async () => {
            const tool = createReadFileTool(fileSystemMock as IFileSystem)
            fileSystemMock.readFile.resolves({ content: 'content' })

            await tool.execute({ filePath: '/path/to/file', limit: 10, offset: 5 })

            sandbox.assert.calledWith(fileSystemMock.readFile, '/path/to/file', sandbox.match({ limit: 10, offset: 5 }))
        })

        it('should propagate file not found error', async () => {
            const tool = createReadFileTool(fileSystemMock as IFileSystem)
            const error = new Error('File not found')
            error.name = 'FileNotFoundError'
            fileSystemMock.readFile.rejects(error)

            try {
                await tool.execute({ filePath: '/missing/file' })
                expect.fail('Should have thrown an error')
            } catch (error: any) {
                expect(error.message).to.include('File not found')
            }
        })

        it('should propagate file too large error', async () => {
            const tool = createReadFileTool(fileSystemMock as IFileSystem)
            const error = new Error('File too large')
            error.name = 'FileTooLargeError'
            fileSystemMock.readFile.rejects(error)

            try {
                await tool.execute({ filePath: '/large/file' })
                expect.fail('Should have thrown an error')
            } catch (error: any) {
                expect(error.message).to.include('File too large')
            }
        })

        it('should propagate path not allowed error', async () => {
            const tool = createReadFileTool(fileSystemMock as IFileSystem)
            const error = new Error('Path not allowed')
            error.name = 'PathNotAllowedError'
            fileSystemMock.readFile.rejects(error)

            try {
                await tool.execute({ filePath: '/forbidden/path' })
                expect.fail('Should have thrown an error')
            } catch (error: any) {
                expect(error.message).to.include('Path not allowed')
            }
        })
    })

    describe('write_file', () => {
        it('should write file content successfully', async () => {
            const tool = createWriteFileTool(fileSystemMock as IFileSystem)
            const mockResult = {
                bytesWritten: 12,
                path: '/path/to/file',
                success: true,
            }
            fileSystemMock.writeFile.resolves(mockResult)

            const result = await tool.execute({
                content: 'new content',
                filePath: '/path/to/file',
            })

            sandbox.assert.calledWith(fileSystemMock.writeFile, '/path/to/file', 'new content', sandbox.match({ createDirs: undefined, encoding: undefined }))
            expect(result).to.deep.equal(mockResult)
        })

        it('should handle createDirs option', async () => {
            const tool = createWriteFileTool(fileSystemMock as IFileSystem)
            fileSystemMock.writeFile.resolves({})

            await tool.execute({
                content: 'content',
                createDirs: true,
                filePath: '/path/to/file',
            })

            expect(fileSystemMock.writeFile.args[0][2]).to.include({ createDirs: true })
        })

        it('should propagate invalid extension error', async () => {
            const tool = createWriteFileTool(fileSystemMock as IFileSystem)
            const error = new Error('Invalid extension')
            error.name = 'InvalidExtensionError'
            fileSystemMock.writeFile.rejects(error)

            try {
                await tool.execute({ content: 'data', filePath: '/path/file.exe' })
                expect.fail('Should have thrown an error')
            } catch (error: any) {
                expect(error.message).to.include('Invalid extension')
            }
        })

        it('should propagate path blocked error', async () => {
            const tool = createWriteFileTool(fileSystemMock as IFileSystem)
            const error = new Error('Path blocked')
            error.name = 'PathBlockedError'
            fileSystemMock.writeFile.rejects(error)

            try {
                await tool.execute({ content: 'data', filePath: '.env' })
                expect.fail('Should have thrown an error')
            } catch (error: any) {
                expect(error.message).to.include('Path blocked')
            }
        })
    })

    describe('edit_file', () => {
        it('should edit file content successfully', async () => {
            const tool = createEditFileTool(fileSystemMock as IFileSystem)
            const mockResult = {
                bytesWritten: 20,
                path: '/path/to/file',
                replacements: 1,
                success: true,
            }
            fileSystemMock.editFile.resolves(mockResult)

            const result = await tool.execute({
                filePath: '/path/to/file',
                newString: 'new',
                oldString: 'old',
            })

            sandbox.assert.calledWith(
                fileSystemMock.editFile,
                '/path/to/file',
                sandbox.match({ newString: 'new', oldString: 'old', replaceAll: undefined }),
                sandbox.match({})
            )
            expect(result).to.deep.equal(mockResult)
        })

        it('should handle replaceAll option', async () => {
            const tool = createEditFileTool(fileSystemMock as IFileSystem)
            fileSystemMock.editFile.resolves({})

            await tool.execute({
                filePath: '/path/to/file',
                newString: 'new',
                oldString: 'old',
                replaceAll: true,
            })

            expect(fileSystemMock.editFile.args[0][1]).to.include({ replaceAll: true })
        })

        it('should propagate string not found error', async () => {
            const tool = createEditFileTool(fileSystemMock as IFileSystem)
            const error = new Error('String not found')
            error.name = 'StringNotFoundError'
            fileSystemMock.editFile.rejects(error)

            try {
                await tool.execute({
                filePath: '/path/file',
                newString: 'new',
                oldString: 'missing',
            })
                expect.fail('Should have thrown an error')
            } catch (error: any) {
                expect(error.message).to.include('String not found')
            }
        })

        it('should propagate string not unique error', async () => {
            const tool = createEditFileTool(fileSystemMock as IFileSystem)
            const error = new Error('String not unique')
            error.name = 'StringNotUniqueError'
            fileSystemMock.editFile.rejects(error)

            try {
                await tool.execute({
                filePath: '/path/file',
                newString: 'new',
                oldString: 'duplicate',
            })
                expect.fail('Should have thrown an error')
            } catch (error: any) {
                expect(error.message).to.include('String not unique')
            }
        })
    })

    describe('glob_files', () => {
        it('should find files matching pattern', async () => {
            const tool = createGlobFilesTool(fileSystemMock as IFileSystem)
            const date = new Date()
            const mockResult = {
                files: [
                    { modified: date, path: '/path/to/file1.ts', size: 100 },
                    { modified: date, path: '/path/to/file2.ts', size: 200 },
                ],
                totalFound: 2,
                truncated: false,
            }
            fileSystemMock.globFiles.resolves(mockResult)

            const result = (await tool.execute({ pattern: '*.ts' })) as any

            sandbox.assert.calledWith(fileSystemMock.globFiles, '*.ts', sandbox.match({ cwd: undefined, includeMetadata: true, maxResults: undefined }))
            expect(result.files).to.have.length(2)
            expect(result.files[0].path).to.equal('/path/to/file1.ts')
            expect(result.files[0].modified).to.equal(date.toISOString())
        })

        it('should handle path and maxResults parameters', async () => {
            const tool = createGlobFilesTool(fileSystemMock as IFileSystem)
            fileSystemMock.globFiles.resolves({ files: [] })

            await tool.execute({ maxResults: 50, path: '/base/path', pattern: '*.ts' })

            sandbox.assert.calledWith(fileSystemMock.globFiles, '*.ts', sandbox.match({ cwd: '/base/path', includeMetadata: true, maxResults: 50 }))
        })

        it('should propagate invalid pattern error', async () => {
            const tool = createGlobFilesTool(fileSystemMock as IFileSystem)
            const error = new Error('Invalid pattern')
            error.name = 'InvalidPatternError'
            fileSystemMock.globFiles.rejects(error)

            try {
                await tool.execute({ pattern: '[invalid' })
                expect.fail('Should have thrown an error')
            } catch (error: any) {
                expect(error.message).to.include('Invalid pattern')
            }
        })

        it('should handle truncated results', async () => {
            const tool = createGlobFilesTool(fileSystemMock as IFileSystem)
            const mockResult = {
                files: [],
                totalFound: 1500,
                truncated: true,
            }
            fileSystemMock.globFiles.resolves(mockResult)

            const result = (await tool.execute({ pattern: '**/*', maxResults: 100 })) as any

            expect(result.truncated).to.be.true
            expect(result.totalFound).to.equal(1500)
        })
    })

    describe('grep_content', () => {
        it('should search content successfully', async () => {
            const tool = createGrepContentTool(fileSystemMock as IFileSystem)
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
            fileSystemMock.searchContent.resolves(mockResult)

            const result = (await tool.execute({ pattern: 'const x' })) as any

            sandbox.assert.calledWith(fileSystemMock.searchContent, 'const x', sandbox.match({
                caseInsensitive: undefined,
                contextLines: undefined,
                cwd: undefined,
                globPattern: undefined,
                maxResults: undefined,
            }))
            expect(result.matches).to.have.length(1)
            expect(result.matches[0].file).to.equal('/path/to/file.ts')
        })

        it('should handle all options', async () => {
            const tool = createGrepContentTool(fileSystemMock as IFileSystem)
            fileSystemMock.searchContent.resolves({ matches: [] })

            await tool.execute({
                caseInsensitive: true,
                contextLines: 2,
                glob: '*.ts',
                maxResults: 50,
                path: '/base/path',
                pattern: 'test',
            })

            sandbox.assert.calledWith(fileSystemMock.searchContent, 'test', sandbox.match({
                caseInsensitive: true,
                contextLines: 2,
                cwd: '/base/path',
                globPattern: '*.ts',
                maxResults: 50,
            }))
        })

        it('should propagate invalid regex pattern error', async () => {
            const tool = createGrepContentTool(fileSystemMock as IFileSystem)
            const error = new Error('Invalid pattern')
            error.name = 'InvalidPatternError'
            fileSystemMock.searchContent.rejects(error)

            try {
                await tool.execute({ pattern: '(unclosed' })
                expect.fail('Should have thrown an error')
            } catch (error: any) {
                expect(error.message).to.include('Invalid pattern')
            }
        })

        it('should handle truncated search results', async () => {
            const tool = createGrepContentTool(fileSystemMock as IFileSystem)
            const mockResult = {
                filesSearched: 100,
                matches: [],
                totalMatches: 250,
                truncated: true,
            }
            fileSystemMock.searchContent.resolves(mockResult)

            const result = (await tool.execute({ pattern: 'test', maxResults: 50 })) as any

            expect(result.truncated).to.be.true
            expect(result.totalMatches).to.equal(250)
        })
    })
})
