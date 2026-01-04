import {expect} from 'chai'
import {readdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

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
    it('should create empty context-tree directory structure', async () => {
      const contextTreePath = await service.initialize(testDir)

      // Verify path structure
      expect(contextTreePath).to.include('.brv/context-tree')

      // Verify directory is empty (domains are created dynamically)
      const domainDirs = await readdir(contextTreePath)
      expect(domainDirs).to.have.lengthOf(0)
    })

    it('should create directory that can hold dynamically created domains', async () => {
      const contextTreePath = await service.initialize(testDir)

      // Verify the directory exists and is accessible
      const entries = await readdir(contextTreePath)
      expect(entries).to.be.an('array')
      // No predefined domains - they are created dynamically by the agent
      expect(entries.length).to.equal(0)
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
