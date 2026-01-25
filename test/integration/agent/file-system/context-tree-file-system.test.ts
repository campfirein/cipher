import { expect } from 'chai'
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createContextTreeFileSystem } from '../../../../src/agent/file-system/context-tree-file-system-factory.js'

describe('Context Tree File System Integration (ENG-835)', () => {
  let testDir: string
  let contextTreePath: string

  beforeEach(async () => {
    const tmp = await realpath(tmpdir())
    testDir = join(tmp, `context-tree-test-${Date.now()}-${Math.random().toString(36).slice(7)}`)

    // Create .brv/context-tree structure
    contextTreePath = join(testDir, '.brv', 'context-tree')
    await mkdir(contextTreePath, { recursive: true })

    // Create a test file
    await writeFile(join(contextTreePath, 'test-file.md'), '# Test Content\nThis is a test file.')

    // Create a nested structure
    const nestedDir = join(contextTreePath, 'domain', 'authentication')
    await mkdir(nestedDir, { recursive: true })
    await writeFile(join(nestedDir, 'context.md'), '# Authentication Context')

    // Create a file outside context-tree (in .brv but not in context-tree)
    await writeFile(join(testDir, '.brv', 'config.json'), '{"secret": "value"}')

    // Create a file in project root
    await writeFile(join(testDir, 'package.json'), '{"name": "test"}')
  })

  afterEach(async () => {
    try {
      await rm(testDir, { force: true, recursive: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('allowed operations', () => {
    it('should read files within context-tree directory', async () => {
      const fs = createContextTreeFileSystem(testDir)
      await fs.initialize()

      const result = await fs.readFile('test-file.md')

      expect(result.content).to.include('Test Content')
    })

    it('should read nested files within context-tree', async () => {
      const fs = createContextTreeFileSystem(testDir)
      await fs.initialize()

      const result = await fs.readFile('domain/authentication/context.md')

      expect(result.content).to.include('Authentication Context')
    })

    it('should list directories within context-tree', async () => {
      const fs = createContextTreeFileSystem(testDir)
      await fs.initialize()

      const result = await fs.listDirectory('.')

      expect(result.entries.length).to.be.greaterThan(0)
      expect(result.entries.some(e => e.name === 'test-file.md')).to.be.true
    })
  })

  describe('blocked operations - path traversal prevention', () => {
    it('should block access to parent directory using ../', async () => {
      const fs = createContextTreeFileSystem(testDir)
      await fs.initialize()

      try {
        await fs.readFile('../config.json')
        expect.fail('Should have thrown an error')
      } catch (error) {
        // Should be blocked by path not allowed check
        expect((error as Error).message).to.include('Path not allowed')
      }
    })

    it('should block access to project root using multiple ../', async () => {
      const fs = createContextTreeFileSystem(testDir)
      await fs.initialize()

      try {
        await fs.readFile('../../package.json')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect((error as Error).message).to.include('Path not allowed')
      }
    })

    it('should block access to system files using path traversal', async () => {
      const fs = createContextTreeFileSystem(testDir)
      await fs.initialize()

      try {
        await fs.readFile('../../../../../../../etc/passwd')
        expect.fail('Should have thrown an error')
      } catch (error) {
        // Should be blocked by either path traversal or allowed paths check
        const { message } = error as Error
        expect(
          message.includes('Path not allowed') ||
          message.includes('Path traversal')
        ).to.be.true
      }
    })

    it('should block access to absolute paths outside context-tree', async () => {
      const fs = createContextTreeFileSystem(testDir)
      await fs.initialize()

      try {
        await fs.readFile('/etc/passwd')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect((error as Error).message).to.include('Path not allowed')
      }
    })

    it('should block access to .brv parent directory directly', async () => {
      const fs = createContextTreeFileSystem(testDir)
      await fs.initialize()

      // Try to access the .brv parent using path that would resolve to it
      try {
        await fs.listDirectory('..')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect((error as Error).message).to.include('Path not allowed')
      }
    })
  })
})
