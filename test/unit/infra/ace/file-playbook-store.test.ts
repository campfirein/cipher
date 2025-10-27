import {expect} from 'chai'
import {existsSync} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {Playbook} from '../../../../src/core/domain/entities/playbook.js'
import {FilePlaybookStore} from '../../../../src/infra/ace/file-playbook-store.js'

describe('FilePlaybookStore', () => {
  let testDir: string
  let store: FilePlaybookStore

  beforeEach(async () => {
    // Create a unique temporary directory for each test
    testDir = join(tmpdir(), `test-playbook-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)
    await mkdir(testDir, {recursive: true})
    store = new FilePlaybookStore()
  })

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await rm(testDir, {force: true, recursive: true})
    }
  })

  describe('clear()', () => {
    it('should clear existing playbook to empty state', async () => {
      // Create a playbook with content
      const playbook = new Playbook()
      playbook.addBullet('Test Section', 'Test bullet content', undefined, {
        codebasePath: process.cwd(),
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      // Save the playbook
      await store.save(playbook, testDir)

      // Verify it has content
      const loadedBeforeClear = await store.load(testDir)
      expect(loadedBeforeClear).to.not.be.undefined
      expect(loadedBeforeClear!.getBullets()).to.have.length(1)

      // Clear the playbook
      await store.clear(testDir)

      // Verify it's now empty
      const loadedAfterClear = await store.load(testDir)
      expect(loadedAfterClear).to.not.be.undefined
      expect(loadedAfterClear!.getBullets()).to.have.length(0)
    })

    it('should do nothing if playbook does not exist', async () => {
      // Verify playbook doesn't exist
      const existsBefore = await store.exists(testDir)
      expect(existsBefore).to.be.false

      // Clear should not throw
      await store.clear(testDir)

      // Playbook still should not exist
      const existsAfter = await store.exists(testDir)
      expect(existsAfter).to.be.false
    })

    it('should preserve directory structure', async () => {
      // Create and save a playbook
      const playbook = new Playbook()
      await store.save(playbook, testDir)

      const aceDir = join(testDir, '.br', 'ace')
      const playbookPath = join(aceDir, 'playbook.json')

      // Verify directory and file exist
      expect(existsSync(aceDir)).to.be.true
      expect(existsSync(playbookPath)).to.be.true

      // Clear the playbook
      await store.clear(testDir)

      // Directory and file should still exist
      expect(existsSync(aceDir)).to.be.true
      expect(existsSync(playbookPath)).to.be.true

      // Load and verify it's empty
      const loaded = await store.load(testDir)
      expect(loaded).to.not.be.undefined
      expect(loaded!.getBullets()).to.have.length(0)
    })

    it('should handle empty playbook gracefully', async () => {
      // Create an already-empty playbook
      const playbook = new Playbook()
      await store.save(playbook, testDir)

      // Clear should not throw even if playbook is already empty
      await store.clear(testDir)

      // Verify it's still empty
      const loaded = await store.load(testDir)
      expect(loaded).to.not.be.undefined
      expect(loaded!.getBullets()).to.have.length(0)
    })
  })

  describe('save()', () => {
    it('should save playbook successfully', async () => {
      const playbook = new Playbook()
      playbook.addBullet('Test', 'Content', undefined, {
        codebasePath: process.cwd(),
        tags: ['test'],
        timestamp: new Date().toISOString(),
      })

      await store.save(playbook, testDir)

      const exists = await store.exists(testDir)
      expect(exists).to.be.true

      const loaded = await store.load(testDir)
      expect(loaded).to.not.be.undefined
      expect(loaded!.getBullets()).to.have.length(1)
    })
  })

  describe('load()', () => {
    it('should return undefined if playbook does not exist', async () => {
      const loaded = await store.load(testDir)
      expect(loaded).to.be.undefined
    })
  })

  describe('exists()', () => {
    it('should return true if playbook exists', async () => {
      const playbook = new Playbook()
      await store.save(playbook, testDir)

      const exists = await store.exists(testDir)
      expect(exists).to.be.true
    })

    it('should return false if playbook does not exist', async () => {
      const exists = await store.exists(testDir)
      expect(exists).to.be.false
    })
  })

  describe('delete()', () => {
    it('should delete existing playbook', async () => {
      const playbook = new Playbook()
      await store.save(playbook, testDir)

      const existsBefore = await store.exists(testDir)
      expect(existsBefore).to.be.true

      await store.delete(testDir)

      const existsAfter = await store.exists(testDir)
      expect(existsAfter).to.be.false
    })

    it('should do nothing if playbook does not exist', async () => {
      await store.delete(testDir)
      // Should not throw
    })
  })
})
