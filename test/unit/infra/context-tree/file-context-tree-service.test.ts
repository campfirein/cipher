import {expect} from 'chai'
import {readdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {CONTEXT_TREE_DOMAINS} from '../../../../src/config/context-tree-domains.js'
import {FileContextTreeService} from '../../../../src/infra/context-tree/file-context-tree-service.js'

describe('FileContextTreeService', () => {
  let service: FileContextTreeService
  let testDir: string

  beforeEach(() => {
    service = new FileContextTreeService()
    // Use temp directory for testing
    testDir = join(tmpdir(), `byterover-test-${Date.now()}`)
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, {force: true, recursive: true})
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('initialize', () => {
    it('should create directory structure', async () => {
      const contextTreePath = await service.initialize(testDir)

      // Verify path structure
      expect(contextTreePath).to.include('.brv/context-tree')

      // Verify all domain directories exist
      const domainDirs = await readdir(contextTreePath)
      expect(domainDirs).to.have.lengthOf(CONTEXT_TREE_DOMAINS.length)
    })

    it('should create all domain folders with context.md files', async () => {
      const contextTreePath = await service.initialize(testDir)

      // Verify all domain directories exist
      const domainDirs = await readdir(contextTreePath)
      expect(domainDirs).to.have.lengthOf(CONTEXT_TREE_DOMAINS.length)

      // Verify each domain has context.md
      await Promise.all(
        CONTEXT_TREE_DOMAINS.map(async (domain) => {
          const contextMdPath = join(contextTreePath, domain.name, 'context.md')
          const contextContent = await readFile(contextMdPath, 'utf8')

          // Verify context.md contains the domain description
          expect(contextContent).to.include(domain.description)
        }),
      )
    })

    it('should create context.md files with proper formatting', async () => {
      const contextTreePath = await service.initialize(testDir)

      // Check one domain specifically
      const codeStylePath = join(contextTreePath, 'code_style', 'context.md')
      const content = await readFile(codeStylePath, 'utf8')

      // Should have title and description
      expect(content).to.include('# Code Style')
      expect(content).to.include('Ensure all code follows style guidelines and quality standards')
    })

    it('should use baseDirectory from config if directory not provided', async () => {
      const serviceWithConfig = new FileContextTreeService({baseDirectory: testDir})

      const contextTreePath = await serviceWithConfig.initialize()

      expect(contextTreePath).to.include(testDir)
      expect(contextTreePath).to.include('.brv/context-tree')
    })
  })

  describe('exists', () => {
    it('should return false if context tree does not exist', async () => {
      const exists = await service.exists(testDir)
      expect(exists).to.be.false
    })

    it('should return true if context tree exists', async () => {
      await service.initialize(testDir)

      const exists = await service.exists(testDir)
      expect(exists).to.be.true
    })

    it('should use baseDirectory from config if directory not provided', async () => {
      const serviceWithConfig = new FileContextTreeService({baseDirectory: testDir})
      await serviceWithConfig.initialize()

      const exists = await serviceWithConfig.exists()
      expect(exists).to.be.true
    })
  })
})
