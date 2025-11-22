
import { expect } from 'chai'
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEditFileTool } from '../../../../../src/infra/cipher/tools/implementations/edit-file-tool.js'
import { createGlobFilesTool } from '../../../../../src/infra/cipher/tools/implementations/glob-files-tool.js'
import { createGrepContentTool } from '../../../../../src/infra/cipher/tools/implementations/grep-content-tool.js'
import { createReadFileTool } from '../../../../../src/infra/cipher/tools/implementations/read-file-tool.js'
import { createWriteFileTool } from '../../../../../src/infra/cipher/tools/implementations/write-file-tool.js'
import { FileSystemService } from '../../../../../src/infra/cipher/file-system/file-system-service.js'

describe('File System Tools Integration', () => {
    let testDir: string
    let fileSystemService: FileSystemService

    beforeEach(async () => {
        const tmp = await realpath(tmpdir())
        testDir = join(tmp, `byterover-test-${Date.now()}-${Math.random().toString(36).substring(7)}`)
        await mkdir(testDir, { recursive: true })

        fileSystemService = new FileSystemService({
            allowedPaths: [testDir],
        })
        await fileSystemService.initialize()
    })

    afterEach(async () => {
        try {
            await rm(testDir, { force: true, recursive: true })
        } catch {
            // Ignore cleanup errors
        }
    })

    describe('read_file', () => {
        it('should read file content', async () => {
            const filePath = join(testDir, 'test.txt')
            await writeFile(filePath, 'Hello World')

            const tool = createReadFileTool(fileSystemService)
            const result = (await tool.execute({ filePath })) as any

            expect(result.content).to.equal('Hello World')
            expect(result.size).to.equal(11)
        })
    })

    describe('write_file', () => {
        it('should write file content', async () => {
            const filePath = join(testDir, 'output.txt')
            const tool = createWriteFileTool(fileSystemService)

            const result = (await tool.execute({
                content: 'New Content',
                filePath,
            })) as any

            expect(result.success).to.be.true

            // Verify with tool
            const readTool = createReadFileTool(fileSystemService)
            const readResult = (await readTool.execute({ filePath })) as any
            expect(readResult.content).to.equal('New Content')
        })
    })

    describe('edit_file', () => {
        it('should edit file content', async () => {
            const filePath = join(testDir, 'edit.txt')
            await writeFile(filePath, 'Hello Old World')

            const tool = createEditFileTool(fileSystemService)
            const result = (await tool.execute({
                filePath,
                newString: 'New',
                oldString: 'Old',
            })) as any

            expect(result.success).to.be.true
            expect(result.replacements).to.equal(1)

            // Verify content
            const readTool = createReadFileTool(fileSystemService)
            const readResult = (await readTool.execute({ filePath })) as any
            expect(readResult.content).to.equal('Hello New World')
        })
    })

    describe('glob_files', () => {
        it('should find files', async () => {
            await writeFile(join(testDir, 'a.ts'), '')
            await writeFile(join(testDir, 'b.js'), '')
            await mkdir(join(testDir, 'subdir'))
            await writeFile(join(testDir, 'subdir/c.ts'), '')

            const tool = createGlobFilesTool(fileSystemService)
            const result = (await tool.execute({
                path: testDir,
                pattern: '**/*.ts',
            })) as any

            expect(result.totalFound).to.equal(2)
            expect(result.files).to.have.length(2)
            const paths = result.files.map((f: any) => f.path).sort()
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
            const result = (await tool.execute({
                path: testDir,
                pattern: 'foo',
            })) as any

            expect(result.totalMatches).to.equal(2)
            expect(result.matches).to.have.length(2)
            const files = result.matches.map((m: any) => m.file).sort()
            expect(files[0]).to.include('file1.txt')
            expect(files[1]).to.include('file3.txt')
        })
    })
})
